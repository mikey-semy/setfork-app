'use server'

import { asc, eq, lt } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, templates, users, type ProposedItem, type StepLevel } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { isLang, langEnName, type LocaleText } from '@/shared/i18n'
import { generateBlockRefine, generateChangeNote, generateListRefine, generateListTranslation } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'
import { aiQuota } from '@/shared/quota'
import { textLang } from '@/shared/i18n/detect-text-lang'
import { toStepInput } from '@/shared/lib/step-input'
import { canEditList, canViewList } from '@/core'
import { isCollaborator } from '@/features/collab/queries'
import { emptyItem, parseEditorItems, toProposedItems, type EditorBlockPatch, type EditorItem } from '../editor'
import { listStore } from '../list-store'
import { hasChanges, summarizeDiffForNote } from '../change-summary'
import { diffSteps, rowsToCmp } from '../diff'
import { notifyWatchersNewVersion } from '../suggestion-side-effects'

/**
 * ИИ поверх списка: доработка пунктов по инструкции, перевод на другой язык,
 * примечание к версии из диффа и заголовок ссылки со страницы.
 *
 * Отдельно от остальных экшенов: у этой четвёрки одна причина меняться — модель,
 * лимиты и квоты, — и только они ходят в `shared/ai`.
 */

// ── AI-refine: правка пунктов редактора по инструкции ────────────────
export async function refineList(input: {
  items: EditorItem[]
  title: string
  desc: string
  tags: string[]
  instruction: string
}): Promise<{ items: EditorItem[] } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const instruction = String(input.instruction ?? '').trim()
  if (!instruction) return { error: 'empty' }

  const { allowed } = await checkRateLimit(`refine:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const current = {
    title: input.title || '',
    desc: input.desc || '',
    tags: input.tags || [],
    items: (input.items || [])
      .filter((it) => it.title?.trim())
      .map((it) => ({
        title: it.title,
        desc: it.desc,
        command: it.command,
        level: it.level ?? 'required',
        why: it.why ?? '',
        subtasks: (it.subtasks || []).filter((s) => s.trim()),
        refs: (it.refs || []).filter((r) => r.label?.trim() && r.url?.trim()).map((r) => ({ label: r.label, url: r.url })),
      })),
  }
  // Язык рефайна = язык СОДЕРЖИМОГО списка, не интерфейса: русский список при
  // en-интерфейсе иначе «улучшался» переводом. Пустой черновик → язык интерфейса.
  const contentLang = current.title || current.items.length
    ? textLang([current.title, current.desc, ...current.items.flatMap((it) => [it.title, it.desc])])
    : lang
  const refined = await generateListRefine(current, instruction, contentLang, { userId: session.userId, feature: 'refine' })
  if (!refined) return { error: 'aifail' }

  // Refine переписывает текстовое содержимое шагов; скриншоты не переносятся, ссылки — да.
  // Форма блока — от ОБЩЕГО конструктора (emptyItem), а не выписанная здесь
  // повторно: иначе каждое новое поле блока надо помнить дописать и сюда.
  const items: EditorItem[] = refined.items.map((it) => ({
    ...emptyItem(),
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    needsHuman: it.needsHuman === true,
    needsHumanAsk: it.needsHumanAsk ?? '',
    subtasks: it.subtasks,
    refs: (it.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
  }))
  return { items }
}

/**
 * Правка ОДНОГО блока по инструкции из чата (кнопка в углу карточки).
 *
 * Отличие от refineList не только в объёме: тот переписывает весь состав и стирает
 * скриншоты, поэтому его нельзя звать «на всякий случай». Здесь человек правит
 * конкретный блок и видит, что именно предлагается, — применить или нет, решает он.
 *
 * Возвращаем ПОЛЯ, а не готовый EditorItem: блок в редакторе живёт со своим id,
 * загруженной картинкой и голосами опроса — их правка текста трогать не должна.
 */
export async function refineBlock(input: {
  block: { title: string; desc: string; command: string; level: StepLevel; why: string; subtasks: string[]; refs: { label: string; url: string }[] }
  instruction: string
  context: { title: string; desc: string }
}): Promise<{ block: EditorBlockPatch } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const instruction = String(input.instruction ?? '').trim()
  if (!instruction) return { error: 'empty' }

  const { allowed } = await checkRateLimit(`refine:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  // Язык правки — язык СОДЕРЖИМОГО блока, не интерфейса: русский пункт при
  // en-интерфейсе иначе «улучшался» переводом (та же причина, что у refineList).
  const contentLang = input.block.title || input.block.desc ? textLang([input.block.title, input.block.desc]) : lang
  const refined = await generateBlockRefine(
    {
      title: input.block.title,
      desc: input.block.desc,
      command: input.block.command,
      level: input.block.level,
      why: input.block.why,
      subtasks: (input.block.subtasks || []).filter((x) => x.trim()),
      refs: (input.block.refs || []).filter((r) => r.label?.trim() && r.url?.trim()),
    },
    instruction,
    { title: input.context.title || '', desc: input.context.desc || '' },
    contentLang,
    { userId: session.userId, feature: 'refine' },
  )
  if (!refined) return { error: 'aifail' }

  return {
    block: {
      title: refined.title,
      desc: refined.desc,
      command: refined.command,
      level: refined.level,
      why: refined.why,
      needsHuman: refined.needsHuman === true,
      needsHumanAsk: refined.needsHumanAsk ?? '',
      subtasks: refined.subtasks,
      refs: (refined.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
    },
  }
}

// ── AI-перевод списка: добавить язык, не трогая оригинал (ADR-0009) ───
export async function translateList(templateId: string, targetLang: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession()
  if (!isLang(targetLang)) return { error: 'badlang' }
  const tpl = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return { error: 'notfound' }
  // Перевод = правка контента: владелец или коллаборатор (как saveNewVersion).
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return { error: 'forbidden' }
  // Архив/заморозка: раньше это ловил только фасадный бэкстоп addVersion, но мета
  // теперь обновляется ДО версии — гейтим явно, чтобы замороженный список не
  // получил переведённые title/desc без версии.
  if (!canEditList(tpl)) return { error: 'forbidden' }

  const { allowed } = await checkRateLimit(`translate:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  if (!cur) return { error: 'notfound' }
  const rows = await db.query.steps.findMany({ where: (s) => eq(s.versionId, cur.id), orderBy: (s, { asc }) => asc(s.n) })

  // Исходный текст поля: значение на любом уже имеющемся языке (en → первый).
  const pick = (lt: LocaleText | null | undefined): string => (lt ? (lt.en ?? Object.values(lt).find(Boolean) ?? '') : '')
  const current = {
    title: pick(tpl.title),
    desc: pick(tpl.desc),
    items: rows.map((s) => ({
      title: pick(s.title),
      desc: pick(s.desc),
      command: s.command,
      level: s.level,
      why: pick(s.why),
      subtasks: (s.subtasks as LocaleText[]).map(pick),
      refs: (s.refs as { label: LocaleText; url?: string }[]).map((r) => ({ label: pick(r.label), url: r.url ?? '' })),
    })),
  }

  const translated = await generateListTranslation(current, targetLang, { userId: session.userId, feature: 'translate' })
  if (!translated) return { error: 'aifail' }
  // Модель обязана сохранить порядок и число шагов — иначе мёрж по индексу уедет.
  if (translated.items.length !== rows.length) return { error: 'mismatch' }

  // Добавить ключ targetLang к LocaleText, СОХРАНИВ существующие языки.
  const add = (lt: LocaleText | null | undefined, val: string): LocaleText => {
    const base = (lt ?? {}) as LocaleText
    return val.trim() ? { ...base, [targetLang]: val.trim() } : base
  }
  const proposed: ProposedItem[] = rows.map((s, i) => {
    const t = translated.items[i]
    const subs = s.subtasks as LocaleText[]
    const refs = s.refs as { label: LocaleText; url?: string }[]
    return {
      // ИДЕНТИЧНОСТЬ БЛОКА переносим: перевод — это то же содержимое на другом языке,
      // а не новые пункты. Без blockId следующая версия получала новые id, и всё, что
      // на идентичности держится (привязка обсуждений, отметки «просмотрено», дифф),
      // читало перевод как «всё удалено и всё добавлено» (ADR-0013).
      blockId: s.blockId ?? undefined,
      type: s.type,
      content: s.content, // poll/quiz/product-контент в v1 не переводим (оставляем как есть)
      title: add(s.title, t.title),
      desc: add(s.desc, t.desc),
      command: s.command,
      hasImage: s.hasImage,
      imageKey: s.imageKey ?? undefined,
      level: s.level,
      why: add(s.why, t.why),
      section: s.section as LocaleText, // секция — заголовок урока; переведём в v2
      // Пометка «здесь нужен человек» — свойство пункта, а не языка: перевод её не
      // отменяет. Набор шагов переписывается целиком, поэтому не перенести = стереть.
      needsHuman: s.needsHuman,
      needsHumanAsk: s.needsHumanAsk as LocaleText,
      subtasks: subs.map((st, k) => add(st, t.subtasks[k] ?? '')),
      refs: refs.map((r, k) => ({ label: add(r.label, t.refs[k]?.label ?? ''), ...(r.url ? { url: r.url } : {}) })),
    }
  })

  const note = `translate → ${langEnName(targetLang)}`
  // Переведённые title/desc едут ВНУТРИ addVersion (Ф2a-довесок): одна транзакция
  // с версией, канон коммита сразу несёт свежую мету.
  await listStore.addVersion(tpl.id, {
    note,
    steps: toStepInput(proposed),
    authorId: session.userId,
    meta: { title: add(tpl.title, translated.title), desc: add(tpl.desc, translated.desc) },
  })
  await notifyWatchersNewVersion(tpl.id, session.userId)

  const owner = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner[0]) revalidatePath(`/${owner[0].handle}/${tpl.slug}`)
  return { ok: true }
}

// ── AI: примечание к версии из диффа (What changed & why) ────────────
export async function generateChangeNoteAction(
  templateId: string,
  itemsJson: string,
): Promise<{ note: string } | { error: string }> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([
    getLang(),
    db.query.templates.findFirst({
      where: (t) => eq(t.id, templateId),
      with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
    }),
  ])
  // Доступно всем, кто может видеть список: владельцу на /edit и предлагающему на
  // /suggest. Генерация читает публичный контент + их черновик; расход считается
  // per-user и ограничен rate-limit'ом + месячной AI-квотой (как generate/refine).
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'forbidden' }

  const { allowed } = await checkRateLimit(`note:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const baseSteps = cur
    ? await db.select().from(steps).where(eq(steps.versionId, cur.id)).orderBy(asc(steps.n))
    : []
  // Заметку пишем по СТРУКТУРНОМУ диффу — тому же, что показывает страница сравнения.
  // Списком заголовков правка описания или команды не видна, и модель, не найдя
  // разницы, сочиняла совет вместо описания (жалоба владельца 04.08.2026).
  const baseCmp = rowsToCmp(baseSteps as unknown as Parameters<typeof rowsToCmp>[0], lang)
  const nextRows = toProposedItems(parseEditorItems(itemsJson), lang)
  const nextCmp = rowsToCmp(nextRows as unknown as Parameters<typeof rowsToCmp>[0], lang)
  const { entries, summary } = diffSteps(baseCmp, nextCmp)
  // Менять нечего — модель не зовём вовсе: это и лишний расход, и источник выдумок.
  if (!hasChanges(summary)) return { error: 'nochange' }

  const note = await generateChangeNote(summarizeDiffForNote(entries), lang, { userId: session.userId, refType: 'template', refId: tpl.id })
  if (!note) return { error: 'aifail' }
  return { note }
}

// ── Автозаголовок ссылки: тянем <title>/og:title со страницы по URL ──────────
// Кнопка «сгенерировать» в ref-блоке редактора: пользователь вставил URL — по нему
// достаём человекочитаемое название страницы в подпись. Требуем сессию + rate-limit;
// SSRF-гейт (протоколы, приватные хосты, redirect-hop, DNS-rebind) — в fetchPublicUrl.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return '' } })
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
  const tt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return decodeEntities(og?.[1] ?? tt?.[1] ?? '').slice(0, 120)
}

export async function fetchLinkTitleAction(url: string): Promise<{ label: string } | { error: string }> {
  const session = await requireSession()
  const { allowed } = await checkRateLimit(`linktitle:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }

  let u: URL
  try { u = new URL(url.trim()) } catch { return { error: 'badurl' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'badurl' }

  try {
    const res = await fetchPublicUrl(u, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'SetForkBot/1.0 (+https://setfork.com)', accept: 'text/html,application/xhtml+xml' },
    })
    if (!res) return { error: 'badurl' }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return { error: 'fetchfail' }
    const html = (await res.text()).slice(0, 200_000)
    const label = extractTitle(html)
    return label ? { label } : { error: 'fetchfail' }
  } catch {
    return { error: 'fetchfail' }
  }
}
