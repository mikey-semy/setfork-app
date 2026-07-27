import 'server-only'
import { and, arrayOverlaps, eq, gte, sql } from 'drizzle-orm'
import { generateText } from 'ai'
import { db, jobs, templates, users } from '@/shared/db'
import { getAiChatClient } from '@/shared/ai/provider'
import { getAiSettings, isAiAvailable } from '@/shared/settings/ai'
import { pickChatModel } from '@/shared/ai/credits'
import { extractUsage, outcomeOf, recordUsage } from '@/shared/ai/usage'
import { generateListDraft } from '@/shared/ai/generate'
import { getRoster, type Expert } from '@/shared/ai/roster'
import { ensureGnomeUser, professionOf } from '@/shared/ai/gnome-account'
import { globalBudgetOk } from '@/shared/quota'
import { enqueueJob } from '@/shared/jobs/queue'
import { listStore } from './list-store'
import { uniqueSlug } from './slug'
import { log } from '@/shared/observability'
import { spotlight } from '@/shared/ai/spotlight'
import { detectTextLang } from '@/shared/lib/translit'
import { toProposed, toStepInput } from '@/shared/lib/step-input'

/**
 * САМОГЕНЕРАЦИЯ: специалист сам пишет список по своей теме — от своего имени.
 *
 * Это инициатива КОМПАНИИ, а не ответ на запрос пользователя: до сих пор список
 * появлялся только когда его кто-то попросил. Два режима (решение владельца):
 *   manual — только по кнопке из зала совета; человек решает, когда и кому поручить;
 *   auto   — та же операция петлёй на существующем планировщике.
 * Плюс off — и это ДЕФОЛТ: автономная трата денег не должна включаться сама.
 *
 * Границы, без которых авто-режим включать нельзя (и они одни на оба режима):
 *   - общий дневной потолок расхода ИИ (globalBudgetOk) — как у садовника;
 *   - свой суточный кап на число списков (selfGenPerDay);
 *   - результат — ЧЕРНОВИК: машинный список не уходит в публичный доступ без человека;
 *   - тема берётся только из доменов специалиста, а не «любая».
 */

export type SelfGenMode = 'off' | 'manual' | 'auto'

/** Как часто просыпается авто-режим. Сутки: список в день на компанию — уже много. */
const EVERY_HOURS = 24

/** Существующие заголовки в доменах специалиста — чтобы не плодить дубли. */
async function existingTitles(e: Expert, limit = 40): Promise<string[]> {
  const domains = e.domains.filter((d) => d && d !== '*')
  if (!domains.length) return []
  const rows = await db
    .select({ title: templates.title })
    .from(templates)
    // arrayOverlaps, а НЕ sql`… && ${domains}`: массив в шаблоне разворачивается в record
    // и Postgres падает на «operator does not exist: text[] && record». Уже ловили это в
    // gnome-account — та же грабля повторилась здесь.
    .where(and(eq(templates.status, 'published'), eq(templates.visibility, 'public'), arrayOverlaps(templates.tags, domains)))
    .limit(limit)
  return rows.map((r) => Object.values(r.title as Record<string, string>)[0] ?? '').filter(Boolean)
}

/**
 * Тема для списка: спрашиваем САМОГО специалиста, чего не хватает в его области.
 * Дёшево (один короткий вызов) и по делу — он знает своё ремесло. Список уже
 * существующих заголовков отдаём, чтобы не предлагал дубль; чужой текст оборачиваем
 * spotlight — заголовки пишут пользователи, это недоверенный ввод.
 */
async function proposeTopic(e: Expert, userId: string): Promise<string | null> {
  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return null
  const model = await pickChatModel(settings)
  const sp = spotlight()
  const have = await existingTitles(e)
  const system = `You are ${e.persona}\nPropose ONE practical list the library is MISSING in your professional area. It must be a concrete, actionable checklist or procedure a real person would follow — not a topic overview. Do not repeat anything from the existing titles. Return ONLY the title, 3-9 words, no quotes, no explanation.\n${sp.rule()}`
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt: `Your domains: ${e.domains.join(', ')}.\n${sp.wrap('EXISTING TITLES', have.join('\n') || '(none)')}\nPropose the missing list title.`,
      temperature: 0.7, // тема — место для разнообразия, иначе каждый прогон даёт одно и то же
      maxOutputTokens: 60,
      abortSignal: AbortSignal.timeout(45_000),
    })
    const u = extractUsage(result)
    await recordUsage({ userId, feature: 'generate', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'selfgen', outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const topic = result.text.trim().replace(/^["'«]|["'»]$/g, '').split('\n')[0].slice(0, 120)
    if (topic.length < 6) return null
    // Дубль по существующим заголовкам ловим и здесь: модель могла проигнорировать запрет.
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (have.some((h) => norm(h) === norm(topic))) return null
    return topic
  } catch (err) {
    await recordUsage({ userId, feature: 'generate', model, input: 0, output: 0, total: 0, cost: 0, refType: 'selfgen', outcome: outcomeOf(err), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return null
  }
}

export interface SelfGenResult {
  ref?: string
  topic?: string
  error?: string
}

/**
 * Одна работа: специалист пишет черновик списка по своей теме. Общая операция для
 * ОБОИХ режимов — ручной вызов и петля идут одним путём, поэтому не разъезжаются.
 */
export async function selfGenerateOne(expertId: string, topicOverride?: string): Promise<SelfGenResult> {
  if (!(await isAiAvailable())) return { error: 'ai-unavailable' }
  if (!(await globalBudgetOk())) return { error: 'budget-exhausted' }

  const roster = await getRoster()
  const expert = roster.find((e) => e.id === expertId)
  if (!expert) return { error: 'expert-not-found' } // выключен, спит, в архиве или не пишущая роль
  const userId = await ensureGnomeUser(expert)
  if (!userId) return { error: 'no-account' } // без аккаунта список некому подписать

  const topic = topicOverride?.trim() || (await proposeTopic(expert, userId))
  if (!topic) return { error: 'no-topic' }

  const lang = detectTextLang(topic)
  const draft = await generateListDraft(topic, lang, { userId, refType: 'selfgen' })
  if (!draft || !draft.items.length) return { error: 'generation-failed', topic }

  const slug = await uniqueSlug(draft.title || topic, userId)
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  await listStore.create({
    ownerId: userId,
    slug,
    title: { [lang]: draft.title || topic },
    desc: draft.desc ? { [lang]: draft.desc } : {},
    tags: draft.tags.slice(0, 8),
    ordered: true,
    visibility: 'public',
    // ЧЕРНОВИК осознанно: машинный список не публикуется без человека. Владелец
    // читает и публикует сам — «предлагает компания, утверждает человек».
    status: 'draft',
    origin: 'ai_draft',
    note: `self-generated by ${professionOf(expert, 'en')}`,
    steps: toStepInput(toProposed(draft.items, lang)),
  })
  log.info('selfgen: draft created', { expert: expert.id, slug, topic })
  return { ref: `${u?.handle ?? ''}/${slug}`, topic }
}

/** Сколько черновиков самогенерации создано за сутки — свой кап, помимо денежного. */
async function createdToday(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(eq(templates.origin, 'ai_draft'), gte(templates.createdAt, sql`date_trunc('day', now())`)))
  return r?.n ?? 0
}

/**
 * Авто-режим: петля. Работает ТОЛЬКО при selfGenMode='auto' — в 'manual' и 'off'
 * просыпается и сразу уходит спать, ничего не тратя.
 */
export async function runSelfGenSweep(): Promise<{ created: number; skipped: number }> {
  await ensureSelfGenScheduled()
  const settings = await getAiSettings()
  if (settings.selfGenMode !== 'auto') {
    log.info('selfgen: mode is not auto, skipping', { mode: settings.selfGenMode })
    return { created: 0, skipped: 1 }
  }
  if (!(await globalBudgetOk())) {
    log.info('selfgen: global AI budget exhausted, skipping')
    return { created: 0, skipped: 1 }
  }
  const cap = settings.selfGenPerDay
  const already = await createdToday()
  if (cap > 0 && already >= cap) {
    log.info('selfgen: daily cap reached', { already, cap })
    return { created: 0, skipped: 1 }
  }

  // Кому поручить: профильные специалисты (универсалы '*' не берут «любую» тему —
  // самогенерация должна расти вглубь домена, а не размазываться).
  const roster = (await getRoster()).filter((e) => !e.domains.includes('*'))
  if (!roster.length) return { created: 0, skipped: 1 }
  // По одному списку за проход: пусть компания растёт ровно, а не рывками.
  const pick = roster[already % roster.length]
  const res = await selfGenerateOne(pick.id)
  if (res.error) {
    log.info('selfgen: nothing created', { expert: pick.id, reason: res.error })
    return { created: 0, skipped: 1 }
  }
  return { created: 1, skipped: 0 }
}

/** Одна pending/processing джоба в очереди — самоподдержание без внешнего cron. */
export async function ensureSelfGenScheduled(): Promise<void> {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'selfgen'), sql`${jobs.status} in ('pending','processing')`))
    .limit(1)
  if (pending) return
  await enqueueJob('selfgen', {}, { delayMs: EVERY_HOURS * 60 * 60 * 1000, maxAttempts: 1 })
}

/** Хендлер джобы для composition root. */
export async function runSelfGenJobHandler(): Promise<void> {
  await runSelfGenSweep()
}
