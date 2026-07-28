import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { changelogEntries, db, jobs } from '@/shared/db'
import { getChangelogSettings, getChangelogToken } from '@/shared/settings/changelog'
import { captureError } from '@/shared/observability'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'
import { enqueueJob } from '@/shared/jobs/queue'
import type { Lang } from '@/shared/i18n'
import { CHANGELOG } from './seed'

export interface ChangelogItem {
  at: Date
  en: string
  ru: string
  href: string | null
}

/**
 * Записи changelog для витрины.
 *
 * Пока БД пуста (свежая установка, джоба ещё не ходила) — отдаём ту самую
 * историю, что раньше жила массивом в коде. Иначе включение подсистемы выглядело
 * бы как потеря всего changelog: было восемь записей, стало ноль.
 */
export async function getChangelog(limit = 50): Promise<ChangelogItem[]> {
  const rows = await db
    .select({ at: changelogEntries.at, en: changelogEntries.en, ru: changelogEntries.ru, href: changelogEntries.href })
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.at))
    .limit(limit)
  if (rows.length > 0) return rows
  return CHANGELOG.slice(0, limit).map((e) => ({ at: new Date(e.date), en: e.en, ru: e.ru, href: e.href ?? null }))
}

/** Текст записи на языке зрителя; пустая сторона — фолбэк на другую. */
export const entryText = (e: ChangelogItem, lang: Lang): string => (lang === 'ru' ? e.ru || e.en : e.en || e.ru)

// ── Обновление из GitHub ─────────────────────────────────────────────

interface Pulled {
  externalId: string
  at: Date
  title: string
  href: string
}

/**
 * Забрать свежее из GitHub: релизы или слитые pull request'ы.
 *
 * Без токена: публичный репозиторий читается анонимно, а держать секрет ради
 * витрины незачем. Ошибку сети НЕ считаем сбоем подсистемы — changelog это
 * витрина, а не бизнес-процесс.
 */
async function pull(repo: string, source: 'releases' | 'merged'): Promise<Pulled[]> {
  // Приватный репозиторий анонимно отдаёт 404 — для него нужен токен. Публичный
  // читается и без него, поэтому токен необязателен.
  const token = await getChangelogToken()
  const url =
    source === 'releases'
      ? `https://api.github.com/repos/${repo}/releases?per_page=20`
      : `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`
  const res = await fetchPublicUrl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'setfork-changelog',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => null)
  if (!res || !res.ok) return []
  const data = (await res.json().catch(() => null)) as unknown
  if (!Array.isArray(data)) return []

  if (source === 'releases') {
    return data
      .map((r) => r as Record<string, unknown>)
      .filter((r) => !r.draft && typeof r.tag_name === 'string')
      .map((r) => ({
        externalId: `rel:${String(r.tag_name)}`,
        at: new Date(String(r.published_at ?? r.created_at ?? Date.now())),
        title: String(r.name || r.tag_name),
        href: String(r.html_url ?? ''),
      }))
  }
  return data
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.merged_at === 'string') // закрытый ≠ слитый
    .map((r) => ({
      externalId: `pr:${String(r.number)}`,
      at: new Date(String(r.merged_at)),
      title: String(r.title ?? ''),
      href: String(r.html_url ?? ''),
    }))
}

/**
 * Обновить changelog из GitHub — идемпотентно по `externalId`.
 *
 * Второй язык добирается переводом, если он включён и ИИ доступен; иначе кладём
 * исходный текст в обе стороны. Пустая сторона хуже дубля: у зрителя на другом
 * языке строка просто исчезла бы.
 */
export async function refreshChangelog(): Promise<{ added: number; skipped: string }> {
  const s = await getChangelogSettings()
  if (!s.enabled) return { added: 0, skipped: 'disabled' }
  if (!s.repo) return { added: 0, skipped: 'no repo' }

  const items = await pull(s.repo, s.source)
  if (items.length === 0) return { added: 0, skipped: 'nothing pulled' }

  const ids = items.map((i) => i.externalId)
  const known = new Set(
    (await db.select({ id: changelogEntries.externalId }).from(changelogEntries).where(inArray(changelogEntries.externalId, ids)))
      .map((r) => r.id)
      .filter((x): x is string => !!x),
  )
  const fresh = items.filter((i) => !known.has(i.externalId))
  if (fresh.length === 0) return { added: 0, skipped: 'up to date' }

  let added = 0
  for (const it of fresh.slice(0, 30)) {
    const { en, ru } = await bilingual(it.title, s.translate)
    try {
      await db
        .insert(changelogEntries)
        .values({ at: it.at, en, ru, href: it.href || null, source: 'github', externalId: it.externalId })
        .onConflictDoNothing()
      added++
    } catch (e) {
      captureError(e, { where: 'changelog.insert' })
    }
  }
  return { added, skipped: '' }
}

/**
 * Заголовок на двух языках.
 *
 * Наши сообщения слияния по-русски, поэтому переводим в английскую сторону.
 * Определяем язык по наличию кириллицы — этого достаточно: заголовок либо
 * русский, либо нет.
 */
async function bilingual(title: string, translate: boolean): Promise<{ en: string; ru: string }> {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 300)
  const isRu = /[а-яё]/i.test(clean)
  if (!translate) return { en: clean, ru: clean }
  const other = await translateLine(clean, isRu ? 'en' : 'ru').catch(() => '')
  if (!other) return { en: clean, ru: clean } // ИИ выключен или не ответил — дубль лучше пустоты
  return isRu ? { en: other, ru: clean } : { en: clean, ru: other }
}

/** Перевод ОДНОЙ строки — короткий вызов, без обвязки генерации списков. */
async function translateLine(text: string, to: Lang): Promise<string> {
  const [{ getAiChatClient }, { getAiSettings }, { pickChatModel }, { generateText }] = await Promise.all([
    import('@/shared/ai/provider'),
    import('@/shared/settings/ai'),
    import('@/shared/ai/credits'),
    import('ai'),
  ])
  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return ''
  const model = await pickChatModel(settings)
  const res = await generateText({
    model: client.chat(model),
    system: `Translate the changelog line to ${to === 'ru' ? 'Russian' : 'English'}. Keep it one line, keep product and code names as is. Return ONLY the translation.`,
    prompt: text,
    temperature: 0,
    maxOutputTokens: 200,
    abortSignal: AbortSignal.timeout(20_000),
  })
  return res.text.trim().split(/\r?\n/)[0].slice(0, 300)
}

/**
 * Держать обновление в очереди — как у остальных самоподдерживающихся джоб.
 *
 * Ставим ВСЕГДА: сама джоба проверит тумблер и в выключенном состоянии ничего не
 * потратит. Так включение из админки начинает работать без рестарта.
 */
export async function ensureChangelogScheduled(): Promise<void> {
  try {
    const [dup] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, 'changelog'), inArray(jobs.status, ['pending', 'processing'])))
      .limit(1)
    if (dup) return
    await enqueueJob('changelog', {})
  } catch (e) {
    captureError(e, { where: 'changelog.ensure' })
  }
}

/** Перепланировать следующий проход по настройке периода. */
export async function scheduleNextChangelog(): Promise<void> {
  const s = await getChangelogSettings()
  await enqueueJob('changelog', {}, { delayMs: s.everyHours * 3600_000 }).catch(() => {})
}
