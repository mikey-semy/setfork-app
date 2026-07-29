import 'server-only'
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { auditLog, db, jobs, linkChecks } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { rateStore } from '@/shared/rate-limit-store'
import { getLinkcheckSettings } from '@/shared/settings/linkcheck'
import { log } from '@/shared/observability'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { classifyProbe, nextVerdict } from './classify'
import { probeUrl, type ProbeFn } from './probe'
import { harvestAll } from './harvest'
import { deliverBrokenLinks } from './deliver'

// Свип link-checker'а («живые списки», Ж1): чанками < reap-порога (30 мин),
// с самоцепочкой до суточного капа. Politeness: per-host token-bucket +
// маленький пул одновременных проб — чужие сайты не дидосим.

/** Одна pending/processing джоба — самоподдержание без cron (паттерн садовника). */
export async function ensureLinkcheckScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'linkcheck'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending.length) return
  const s = await getLinkcheckSettings()
  await enqueueJob('linkcheck', {}, { delayMs: s.everyHours * 3_600_000, maxAttempts: 1 })
  log.info('linkcheck scheduled', { inHours: s.everyHours })
}

/** Payload самоцепочки: chained=true — продолжение свипа, харвест не повторяем. */
export interface LinkcheckPayload {
  chained?: boolean
}

/** Проб за сегодня (суточный кап — вежливость и предсказуемая нагрузка). */
async function probesToday(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(linkChecks)
    .where(and(isNotNull(linkChecks.checkedAt), gte(linkChecks.checkedAt, sql`date_trunc('day', now())`)))
  return row?.c ?? 0
}

/** Один батч свипа. probe инжектируется для интеграционных тестов (сети в CI нет). */
export async function runLinkcheckSweep(payload: LinkcheckPayload = {}, probe: ProbeFn = probeUrl): Promise<{ probed: number; chained: boolean }> {
  const s = await getLinkcheckSettings()
  if (!s.enabled) {
    log.info('linkcheck: disabled, skipping')
    return { probed: 0, chained: false }
  }
  // Сухой прогон — как у остальных петель: рубильник показан для всех, и петля,
  // которая его не читает, обещает безопасность, которой нет.
  const loop = await loopPolicy('linkcheck')
  if (loop.dryRun) {
    await recordAgentAction({ loop: 'linkcheck', action: 'probe', resultStatus: 'dry-run', decision: { mode: 'skip-live-run' }, policyVersion: loop.policyVersion })
    log.info('linkcheck: сухой прогон — ссылки не проверяем')
    return { probed: 0, chained: false }
  }
  const startedAt = Date.now()
  // Харвест + доставка битых ссылок — только в голове цепочки (раз в проход).
  if (!payload.chained) {
    await harvestAll()
    // Ж1b: доставка идёт после харвеста (свежие occurrences) и не зависит от ИИ.
    // Сама решает, включена ли (linkcheck.deliver_issues); ошибку не роняем в свип.
    await deliverBrokenLinks().catch((e) => log.error('linkcheck deliver failed', { err: String(e) }))
  }

  const already = await probesToday()
  const budget = Math.max(0, Math.min(s.batchProbes, s.dailyCap - already))
  if (budget === 0) {
    log.info('linkcheck: daily cap reached', { already })
    return { probed: 0, chained: false }
  }

  const due = await db
    .select()
    .from(linkChecks)
    .where(lte(linkChecks.nextCheckAt, sql`now()`))
    .orderBy(linkChecks.nextCheckAt)
    .limit(budget)

  const store = rateStore()
  let probed = 0
  let broken = 0
  let unreachable = 0
  // Мини-пул одновременных проб (паттерн runner из jobs/worker, без p-limit).
  const queue = [...due]
  const worker = async () => {
    for (;;) {
      const row = queue.shift()
      if (!row) return
      // Politeness: не чаще perHostPerMin на хост; не пустило — отложим URL
      // на retryAfter, он уйдёт в следующий батч цепочки. Ёмкость (burst) = сама
      // поминутная норма хоста, НЕ хардкод: список с N ссылками на один хост должен
      // пробиться за один свип, а не растягиваться по 2 на 48ч (баг захардкоженного «2»).
      const gate = await store.tokenBucket(`lc:${row.host}`, Math.max(2, s.perHostPerMin), s.perHostPerMin / 60)
      if (!gate.allowed) {
        await db
          .update(linkChecks)
          .set({ nextCheckAt: new Date(Date.now() + Math.max(1_000, gate.retryAfter * 1_000)) })
          .where(eq(linkChecks.id, row.id))
        continue
      }
      const out = await probe(row.urlNorm)
      const changedUrl = !!out.finalUrl && out.finalUrl !== row.urlNorm
      const cls = classifyProbe(out, changedUrl)
      const esc = nextVerdict(cls, row.failCount, s.brokenFails)
      if (esc.verdict === 'broken') broken++
      if (esc.verdict === 'unreachable') unreachable++
      const now = new Date()
      await db
        .update(linkChecks)
        .set({
          httpStatus: out.status,
          finalUrl: out.finalUrl ?? null,
          verdict: esc.verdict,
          reason: cls.reason,
          failCount: esc.failCount,
          lastOkAt: esc.verdict === 'ok' || esc.verdict === 'redirected' ? now : row.lastOkAt,
          checkedAt: now,
          // Следующая проверка — через период свипа (битые перепроверяются так же:
          // сайт мог ожить; вердикт исправится и failCount сбросится).
          nextCheckAt: new Date(Date.now() + s.everyHours * 3_600_000),
        })
        .where(eq(linkChecks.id, row.id))
      probed++
    }
  }
  await Promise.all(Array.from({ length: Math.min(s.concurrency, queue.length || 1) }, worker))

  // Остались due-URL и кап не исчерпан → продолжаем цепочку почти сразу.
  const [restRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(linkChecks)
    .where(lte(linkChecks.nextCheckAt, sql`now()`))
  const rest = restRow?.c ?? 0
  const chained = rest > 0 && already + probed < s.dailyCap
  if (chained) await enqueueJob('linkcheck', { chained: true }, { delayMs: 10_000, maxAttempts: 1 })

  try {
    await db.insert(auditLog).values({
      action: 'linkcheck.sweep',
      meta: { probed, broken, unreachable, rest, chained, ms: Date.now() - startedAt },
    })
  } catch {
    // журнал вторичен — свип не роняем
  }
  log.info('linkcheck sweep done', { probed, broken, unreachable, rest, chained })
  return { probed, chained }
}
