import 'server-only'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, jobs, steps, templates, templateVersions, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { captureError } from '@/shared/observability'
import { moderateContent, type ModerationVerdict } from '@/shared/ai/moderate'
import { getApiKey } from '@/shared/settings/ai'
import { enqueueJob } from '@/shared/jobs/queue'
import {
  checkSpamHeuristics,
  contentFingerprint,
  fingerprintBody,
  MIN_FINGERPRINT_BODY,
  routeVerdict,
  type ListSignals,
} from './automation'

const flat = (x: LocaleText | null | undefined) => (x ? Object.values(x).filter(Boolean).join(' / ') : '')

// Кап LLM-проверок на автора в сутки: защита от расхода OpenRouter циклом
// publish/save (git push пропускает до 240 запросов/мин — без капа это деньги).
const MODERATE_DAILY_CAP = 20

interface LoadedList {
  signals: ListSignals
  stepTitles: string[]
  ownerId: string
  moderation: string
}

/** Сигналы списка для проверки: текст (LLM + извлечение ссылок), заголовки шагов
 *  (отпечаток), счётчики (эвристики). Берём ПОСЛЕДНЮЮ версию — проверяем то,
 *  что реально увидит зритель после правки. URL из refs — в начале текста,
 *  чтобы не отрезались лимитом классификатора (4000 символов). */
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
    ...(refUrls as string[]),
    ...stepRows.map((s, i) => `${i + 1}. ${flat(s.title)} — ${flat(s.desc)} ${s.command}`),
  ]
    .filter(Boolean)
    .join('\n')
  return {
    signals: { title: flat(tpl.title), stepCount: stepRows.length, text },
    stepTitles: stepRows.map((s) => flat(s.title)),
    ownerId: tpl.ownerId,
    moderation: tpl.moderation,
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
 *  без нарушений (≥3 живых публичных списков НЕ считая проверяемого, 0 flagged/hidden). */
async function isTrustedAuthor(ownerId: string, exceptTemplateId: string): Promise<boolean> {
  const [r] = await db
    .select({
      curated: users.curated,
      good: sql<number>`count(*) filter (where ${templates.moderation} = 'active' and ${templates.visibility} = 'public' and ${templates.status} = 'published' and ${templates.id} <> ${exceptTemplateId})::int`,
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

/** Постановка moderate-джобы с дедупом (одна невыполненная на список — она всё
 *  равно проверит последнюю версию) и суточным капом LLM-вызовов на автора. */
async function enqueueModerate(templateId: string, gate: boolean, ownerId: string): Promise<'queued' | 'dup' | 'capped'> {
  const [dup] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.type, 'moderate'), inArray(jobs.status, ['pending', 'processing']), sql`${jobs.payload}->>'templateId' = ${templateId}`),
    )
    .limit(1)
  if (dup) return 'dup'
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .innerJoin(templates, sql`(${jobs.payload}->>'templateId')::uuid = ${templates.id}`)
    .where(and(eq(jobs.type, 'moderate'), eq(templates.ownerId, ownerId), sql`${jobs.createdAt} > now() - interval '24 hours'`))
  if ((c?.n ?? 0) >= MODERATE_DAILY_CAP) return 'capped'
  await enqueueJob('moderate', { templateId, gate })
  return 'queued'
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
    // flagged/hidden не «отмываются» переключением видимости/повторной публикацией —
    // их судьбу решает только админ (апелляция или очередь).
    if (tpl.moderation === 'flagged' || tpl.moderation === 'hidden') return
    if (await isTrustedAuthor(tpl.ownerId, templateId)) {
      await enqueueModerate(templateId, false, tpl.ownerId)
      return
    }
    await db
      .update(templates)
      .set({ moderation: 'pending', moderationReason: null, moderationSeverity: 0 })
      .where(eq(templates.id, templateId))
    const q = await enqueueModerate(templateId, true, tpl.ownerId)
    if (q === 'capped') {
      // кап расхода: остаётся pending с пометкой — решит человек, LLM не тратим
      await db
        .update(templates)
        .set({ moderationReason: 'publication rate limit — awaiting manual review', moderationSeverity: 1 })
        .where(and(eq(templates.id, templateId), eq(templates.moderation, 'pending')))
    }
  } catch (e) {
    // гейт не должен ронять публикацию; список остаётся active — но след оставляем
    captureError(e, { where: 'moderation.gate', templateId })
  }
}

/**
 * Пере-проверка УЖЕ видимого списка после правки (новая версия / merge / принятая
 * правка / git push). Список остаётся видимым, проверка идёт в фоне; нарушение → flagged.
 */
export async function recheckList(templateId: string): Promise<void> {
  try {
    if (!(await getApiKey())) return
    const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
    if (!tpl) return
    await enqueueModerate(templateId, false, tpl.ownerId)
  } catch (e) {
    captureError(e, { where: 'moderation.recheck', templateId })
  }
}

export interface ModerateJobPayload {
  templateId: string
  gate: boolean // true — решаем судьбу pending-списка; false — фоновая пере-проверка видимого
}

/** Флаг с защитой от гонки: не перетираем свежее ручное решение админа (hidden
 *  или уже одобренный им flagged→active обрабатываются только из pending/active). */
async function setFlagged(templateId: string, reason: string, severity: number): Promise<void> {
  await db
    .update(templates)
    .set({ moderation: 'flagged', moderationReason: reason, moderationSeverity: severity })
    .where(and(eq(templates.id, templateId), inArray(templates.moderation, ['pending', 'active'])))
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
 * 1) спам-эвристики — 0 токенов (только на гейте: живой список эвристикой не роняем);
 * 2) отпечаток — повторная заливка удалённого; 3) ИИ-классификатор с порогами
 * уверенности: уверенно-safe → active, уверенно-unsafe → flagged, серая зона →
 * остаётся pending для человека. ИИ недоступен → ретраи; на последней попытке
 * fail-open (кроме нарушителей).
 */
export async function runModerateJob(payload: unknown, attempt: { attempts: number; maxAttempts: number }): Promise<void> {
  const p = payload as ModerateJobPayload
  const loaded = await loadListSignals(p.templateId)
  if (!loaded) return // список удалён — нечего проверять
  // Эффективный гейт: правка владельцем hold-списка (pending) должна уметь
  // одобрить его — иначе исправленный список застревает в pending навсегда.
  const gate = p.gate || loaded.moderation === 'pending'

  if (gate) {
    const h = checkSpamHeuristics(loaded.signals)
    if (h.spam) {
      await setFlagged(p.templateId, h.reason, 2)
      return
    }
  }

  const body = fingerprintBody(loaded.signals.title, loaded.stepTitles)
  const fp = body.length >= MIN_FINGERPRINT_BODY ? contentFingerprint(loaded.signals.title, loaded.stepTitles) : null
  await db.update(templates).set({ contentFingerprint: fp }).where(eq(templates.id, p.templateId))
  if (fp) {
    // Родословную (forked_from) НЕ исключаем сознательно: иначе self-fork
    // flagged-списка отмывал бы удалённый контент. Невиновный форк, чей
    // оригинал сняли позже, попадёт к человеку с внятной причиной — приемлемо.
    const [dup] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(eq(templates.contentFingerprint, fp), ne(templates.id, p.templateId), inArray(templates.moderation, ['flagged', 'hidden'])),
      )
      .limit(1)
    if (dup) {
      await setFlagged(p.templateId, 'Re-upload of previously removed content', 3)
      return
    }
  }

  const verdict = await moderateContent(loaded.signals.text, { refId: p.templateId })
  if (!verdict) {
    if (attempt.attempts >= attempt.maxAttempts) {
      if (!gate) return
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

  const route = routeVerdict(verdict, gate)
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
 *  повторную заливку удалённого не поймать. Идемпотентно, батчами до исчерпания. */
export async function ensureModerationFingerprints(): Promise<void> {
  for (let batch = 0; batch < 20; batch++) {
    const rows = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(inArray(templates.moderation, ['flagged', 'hidden']), sql`${templates.contentFingerprint} is null`))
      .limit(200)
    for (const r of rows) {
      const loaded = await loadListSignals(r.id)
      if (!loaded) continue
      const body = fingerprintBody(loaded.signals.title, loaded.stepTitles)
      await db
        .update(templates)
        // вырожденное тело помечаем пустой строкой (не null) — чтобы батч не крутился на них вечно
        .set({ contentFingerprint: body.length >= MIN_FINGERPRINT_BODY ? contentFingerprint(loaded.signals.title, loaded.stepTitles) : '' })
        .where(eq(templates.id, r.id))
    }
    if (rows.length < 200) break
  }
}
