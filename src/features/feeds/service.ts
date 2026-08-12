import 'server-only'
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db, feedItems, feedSources, jobs } from '@/shared/db'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'
import { feedItemKey, parseFeed } from '@/shared/ai/feed-parse'
import { enqueueJob } from '@/shared/jobs/queue'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { autonomyHealthy } from '@/shared/agents/canary'
import { log } from '@/shared/observability'
import { botUserAgent } from '@/shared/site'

/**
 * ПЕТЛЯ СБОРА ПОТОКА — источник свежего материала для живых списков.
 *
 * Почему это петля, а не разовый скрипт: лента живёт только пока в неё что-то приходит. Ритм
 * задаёт сама подписка (`every_hours`), а планировщик у нас уже есть — заводить второй нельзя.
 *
 * Три вещи, которые здесь принципиальны:
 *   1. ВЫХОД НАРУЖУ ТОЛЬКО через fetchPublicUrl. SSRF-защита написана там; вторая точка выхода
 *      обошла бы её молча, а мы тянем адреса, которые назвал пользователь.
 *   2. ТЕЛО СТАТЕЙ НЕ ХРАНИМ. Новости не под свободной лицензией: нужен факт и адрес,
 *      формулировку специалист пишет сам. Подсказка из потока — для отбора, не для публикации.
 *   3. НИ ОДНОГО ВЫЗОВА МОДЕЛИ. Сбор — это сеть и разбор; думать над материалом будет
 *      специалист отдельным шагом, и только когда решит владелец.
 *
 * Ошибка одной подписки не роняет проход: записываем её в last_error и идём дальше — иначе
 * один упавший источник останавливал бы все.
 */

/** Как часто просыпается петля. Сама подписка решает, пора ли её тянуть. */
const SWEEP_HOURS = 1

/** Сколько подписок за проход — чтобы длинный список источников не давал долгий проход. */
const PER_SWEEP = 8

/** Одна pending/processing джоба — самоподдержание без внешнего cron. */
export async function ensureFeedPullScheduled(): Promise<void> {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'feedpull'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending) return
  await enqueueJob('feedpull', {}, { delayMs: SWEEP_HOURS * 60 * 60 * 1000, maxAttempts: 1 })
}

/** Подписки, которым пора: никогда не тянули ИЛИ прошло их every_hours. */
async function dueSources(limit: number) {
  return db
    .select()
    .from(feedSources)
    .where(
      and(
        eq(feedSources.enabled, true),
        or(isNull(feedSources.lastPulledAt), lte(feedSources.lastPulledAt, sql`now() - (${feedSources.everyHours} * interval '1 hour')`)),
      ),
    )
    .orderBy(asc(feedSources.lastPulledAt))
    .limit(limit)
}

export interface PullResult {
  sources: number
  fetched: number
  fresh: number
  failed: number
}

/** Один проход: тянем подписки, которым пора, и кладём НОВЫЕ элементы. */
export async function runFeedPullSweep(): Promise<PullResult> {
  await ensureFeedPullScheduled()
  // Здоровье автономии — как у остальных петель: серия ошибок рвёт предохранитель.
  if (!(await autonomyHealthy('feedpull'))) {
    log.info('feedpull: circuit tripped by canary, skipping sweep')
    return { sources: 0, fetched: 0, fresh: 0, failed: 0 }
  }
  const loop = await loopPolicy('feedpull')
  const due = await dueSources(PER_SWEEP)
  const out: PullResult = { sources: due.length, fetched: 0, fresh: 0, failed: 0 }
  if (!due.length) return out

  for (const src of due) {
    // Сухой прогон: решение записываем, в сеть не идём и ничего не пишем.
    if (loop.dryRun) {
      await recordAgentAction({
        loop: 'feedpull',
        action: 'feed.pull',
        resultStatus: 'dry-run',
        signal: { url: src.url, everyHours: src.everyHours },
        decision: { reason: 'due by schedule' },
        policyVersion: loop.policyVersion,
      })
      continue
    }

    const res = await pullSource(src)
    out.fetched += res.fetched
    out.fresh += res.fresh
    if (res.error) out.failed++
    await recordAgentAction({
      loop: 'feedpull',
      action: 'feed.pull',
      resultStatus: res.error ? 'error' : 'ok',
      signal: { url: src.url },
      decision: { fetched: res.fetched, fresh: res.fresh },
      resultRef: src.url.slice(0, 300),
      error: res.error,
      policyVersion: loop.policyVersion,
    })
  }
  log.info('feedpull sweep done', { ...out })
  return out
}

/**
 * Тянуть одну подписку. Возвращает, сколько элементов пришло и сколько из них НОВЫХ.
 * Ошибки не бросаем: сохраняем в last_error, чтобы человек увидел мёртвый источник в админке.
 */
export async function pullSource(src: typeof feedSources.$inferSelect): Promise<{ fetched: number; fresh: number; error: string }> {
  let body = ''
  try {
    const res = await fetchPublicUrl(src.url, {
      headers: { 'user-agent': botUserAgent(), accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res) throw new Error('источник недоступен или адрес запрещён')
    if (!res.ok) throw new Error(`ответ ${res.status}`)
    // Потолок на размер: лента на десять мегабайт — это не лента, а ошибка на той стороне.
    body = (await res.text()).slice(0, 2_000_000)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.update(feedSources).set({ lastPulledAt: new Date(), lastError: error.slice(0, 300), lastItems: 0 }).where(eq(feedSources.id, src.id))
    return { fetched: 0, fresh: 0, error }
  }

  const items = parseFeed(body)
  let fresh = 0
  for (const it of items) {
    const key = feedItemKey(it.url)
    // onConflictDoNothing по ключу: повтор из другой ленты — не новость.
    const inserted = await db
      .insert(feedItems)
      .values({
        sourceId: src.id,
        key,
        url: it.url,
        title: it.title,
        hint: it.hint,
        publishedAt: it.publishedAt,
        tags: src.tags,
      })
      .onConflictDoNothing({ target: feedItems.key })
      .returning({ id: feedItems.id })
    if (inserted.length) fresh++
  }
  await db
    .update(feedSources)
    .set({ lastPulledAt: new Date(), lastError: '', lastItems: items.length })
    .where(eq(feedSources.id, src.id))
  return { fetched: items.length, fresh, error: '' }
}

/** Хендлер джобы для composition root. */
export async function runFeedPullJob(): Promise<void> {
  try {
    await runFeedPullSweep()
  } finally {
    await ensureFeedPullScheduled()
  }
}
