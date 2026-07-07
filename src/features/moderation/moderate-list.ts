import 'server-only'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { moderateContent, type ModerationVerdict } from '@/shared/ai/moderate'
import { getApiKey } from '@/shared/settings/ai'
import { enqueueJob } from '@/shared/jobs/queue'
import { checkSpamHeuristics, contentFingerprint, routeVerdict, type ListSignals } from './automation'

const flat = (x: LocaleText | null | undefined) => (x ? Object.values(x).filter(Boolean).join(' / ') : '')

interface LoadedList {
  signals: ListSignals
  stepTitles: string[]
  ownerId: string
}

/** Сигналы списка для проверки: текст (LLM + извлечение ссылок), заголовки шагов
 *  (отпечаток), счётчики (эвристики). Берём ПОСЛЕДНЮЮ версию — проверяем то,
 *  что реально увидит зритель после правки. */
async function loadListSignals(templateId: string): Promise<LoadedList | null> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return null
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version))
    .limit(1)
  const stepRows = ver ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n)) : []
  const refUrls = stepRows.flatMap((s) =>
    Array.isArray(s.refs) ? (s.refs as { url?: string }[]).map((r) => r?.url).filter(Boolean) : [],
  )
  const text = [
    flat(tpl.title),
    flat(tpl.desc),
    ...stepRows.map((s, i) => `${i + 1}. ${flat(s.title)} — ${flat(s.desc)} ${s.command}`),
    ...(refUrls as string[]),
  ]
    .filter(Boolean)
    .join('\n')
  return {
    signals: { title: flat(tpl.title), stepCount: stepRows.length, text },
    stepTitles: stepRows.map((s) => flat(s.title)),
    ownerId: tpl.ownerId,
  }
}

/** Текст списка для ручной ИИ-проверки из админки. */
export async function buildListText(templateId: string): Promise<string> {
  return (await loadListSignals(templateId))?.signals.text ?? ''
}

export function verdictReason(v: ModerationVerdict): string {
  return `AI [${v.category || '—'}]: ${v.reason}`
}

/** Доверенный автор (Discourse-модель): кураторский аккаунт либо история
 *  без нарушений (≥3 живых публичных списков, 0 flagged/hidden). */
async function isTrustedAuthor(ownerId: string): Promise<boolean> {
  const [r] = await db
    .select({
      curated: users.curated,
      good: sql<number>`count(*) filter (where ${templates.moderation} = 'active' and ${templates.visibility} = 'public' and ${templates.status} = 'published')::int`,
      bad: sql<number>`count(*) filter (where ${templates.moderation} in ('flagged','hidden'))::int`,
    })
    .from(users)
    .leftJoin(templates, eq(templates.ownerId, users.id))
    .where(eq(users.id, ownerId))
    .groupBy(users.id, users.curated)
  if (!r) return false
  return r.curated || (r.good >= 3 && r.bad === 0)
}

/** Нарушитель: уже имеет flagged/hidden списки (кроме проверяемого). Ему не
 *  положен fail-open — при недоступном ИИ его публикация ждёт человека. */
async function isOffenderAuthor(ownerId: string, exceptTemplateId: string): Promise<boolean> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(
      and(
        eq(templates.ownerId, ownerId),
        ne(templates.id, exceptTemplateId),
        inArray(templates.moderation, ['flagged', 'hidden']),
      ),
    )
  return (r?.n ?? 0) > 0
}

/**
 * Гейт публикации (модель YouTube): публичный список уходит в pending —
 * не виден никому, кроме владельца/админа, — и встаёт в очередь на авто-проверку.
 * Доверенные авторы публикуются сразу (пере-проверка фоном). Без настроенного
 * ИИ-ключа гейт выключен: список остаётся active (dev/стенды).
 */
export async function gateListPublication(templateId: string): Promise<void> {
  try {
    if (!(await getApiKey())) return
    const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
    if (!tpl) return
    if (await isTrustedAuthor(tpl.ownerId)) {
      await enqueueJob('moderate', { templateId, gate: false })
      return
    }
    await db
      .update(templates)
      .set({ moderation: 'pending', moderationReason: null, moderationSeverity: 0 })
      .where(eq(templates.id, templateId))
    await enqueueJob('moderate', { templateId, gate: true })
  } catch {
    /* гейт не должен ронять публикацию; список остаётся active */
  }
}

/**
 * Пере-проверка УЖЕ видимого списка после правки (новая версия / merge / принятая
 * правка / git push). Список остаётся видимым, проверка идёт в фоне; нарушение → flagged.
 */
export async function recheckList(templateId: string): Promise<void> {
  try {
    if (!(await getApiKey())) return
    await enqueueJob('moderate', { templateId, gate: false })
  } catch {
    /* не критичный путь */
  }
}

export interface ModerateJobPayload {
  templateId: string
  gate: boolean // true — решаем судьбу pending-списка; false — фоновая пере-проверка видимого
}

async function setFlagged(templateId: string, reason: string, severity: number): Promise<void> {
  await db
    .update(templates)
    .set({ moderation: 'flagged', moderationReason: reason, moderationSeverity: severity })
    .where(eq(templates.id, templateId))
}

/** Одобрение строго из pending — не перетираем ручное решение админа,
 *  случившееся между постановкой джобы и её выполнением. */
async function approvePending(templateId: string, note: string | null): Promise<void> {
  await db
    .update(templates)
    .set({ moderation: 'active', moderationReason: note, moderationSeverity: 0 })
    .where(and(eq(templates.id, templateId), eq(templates.moderation, 'pending')))
}

/**
 * Джоб-логика авто-проверки, ярусами (как у больших платформ):
 * 1) спам-эвристики — 0 токенов; 2) отпечаток — повторная заливка удалённого;
 * 3) ИИ-классификатор с порогами уверенности: уверенно-safe → active,
 * уверенно-unsafe → flagged, серая зона → остаётся pending для человека.
 * ИИ недоступен → ретраи; на последней попытке fail-open (кроме нарушителей).
 */
export async function runModerateJob(payload: unknown, attempt: { attempts: number; maxAttempts: number }): Promise<void> {
  const p = payload as ModerateJobPayload
  const loaded = await loadListSignals(p.templateId)
  if (!loaded) return // список удалён — нечего проверять

  const h = checkSpamHeuristics(loaded.signals)
  if (h.spam) {
    await setFlagged(p.templateId, h.reason, 2)
    return
  }

  const fp = contentFingerprint(loaded.signals.title, loaded.stepTitles)
  await db.update(templates).set({ contentFingerprint: fp }).where(eq(templates.id, p.templateId))
  const [dup] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.contentFingerprint, fp),
        ne(templates.id, p.templateId),
        inArray(templates.moderation, ['flagged', 'hidden']),
      ),
    )
    .limit(1)
  if (dup) {
    await setFlagged(p.templateId, 'Re-upload of previously removed content', 3)
    return
  }

  const verdict = await moderateContent(loaded.signals.text, { refId: p.templateId })
  if (!verdict) {
    if (attempt.attempts >= attempt.maxAttempts) {
      if (!p.gate) return
      if (await isOffenderAuthor(loaded.ownerId, p.templateId)) {
        // нарушителю fail-open не положен: остаётся pending до человека
        await db
          .update(templates)
          .set({ moderationReason: 'AI unavailable — awaiting manual review', moderationSeverity: 1 })
          .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
        return
      }
      await approvePending(p.templateId, 'auto-approved: AI unavailable')
      return
    }
    throw new Error('moderation AI unavailable')
  }

  const route = routeVerdict(verdict, p.gate)
  if (route.action === 'flag') await setFlagged(p.templateId, route.reason, route.severity)
  else if (route.action === 'approve') await approvePending(p.templateId, null)
  else if (route.action === 'hold')
    await db
      .update(templates)
      .set({ moderationReason: route.reason, moderationSeverity: route.severity })
      .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
  // 'none' — пере-проверка видимого без нарушений: ничего не делаем
}

/** На старте воркера: отпечатки для ранее flagged/hidden списков — без них
 *  повторную заливку удалённого не поймать. Идемпотентно, дёшево. */
export async function ensureModerationFingerprints(): Promise<void> {
  const rows = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(inArray(templates.moderation, ['flagged', 'hidden']), sql`${templates.contentFingerprint} is null`))
    .limit(200)
  for (const r of rows) {
    const loaded = await loadListSignals(r.id)
    if (!loaded) continue
    await db
      .update(templates)
      .set({ contentFingerprint: contentFingerprint(loaded.signals.title, loaded.stepTitles) })
      .where(eq(templates.id, r.id))
  }
}
