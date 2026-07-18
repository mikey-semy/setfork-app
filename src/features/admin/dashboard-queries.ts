import 'server-only'
import { eq, gte, sql } from 'drizzle-orm'
import { aiUsage, db, generations, jobs, sessions, templates, users } from '@/shared/db'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { getUsageTotals } from '@/shared/ai/usage'
import { AI_DAILY_USD } from '@/shared/quota'
import { getUmamiActive, umamiConfigured } from '@/shared/analytics/umami'
import type { DashboardSeries, LiveMetrics } from './dashboard-types'

// Дашборд читает то, что уже есть в БД (плюс Umami для анонимов). Схему не меняет — только SELECT.
// «Сегодня» = с начала UTC-суток (date_trunc('day', now())), как дневной кап в quota.ts.

const ONLINE_WINDOW_MS = 5 * 60_000
const DAY = sql`date_trunc('day', now())`

/** Счётчики за сегодня одним проходом на таблицу. */
async function getTodayCounts(): Promise<LiveMetrics['today']> {
  const [gen, usr, tpl] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${generations.status} = 'failed')::int`,
      })
      .from(generations)
      .where(gte(generations.createdAt, DAY)),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, DAY)),
    db
      .select({
        created: sql<number>`count(*)::int`,
        published: sql<number>`count(*) filter (where ${templates.status} = 'published')::int`,
        forks: sql<number>`count(*) filter (where ${templates.forkedFromId} is not null)::int`,
      })
      .from(templates)
      .where(gte(templates.createdAt, DAY)),
  ])
  return {
    generations: gen[0]?.total ?? 0,
    generationsFailed: gen[0]?.failed ?? 0,
    signups: usr[0]?.n ?? 0,
    newLists: tpl[0]?.created ?? 0,
    published: tpl[0]?.published ?? 0,
    forks: tpl[0]?.forks ?? 0,
  }
}

/** Живой снимок для верхних плиток и /api/admin/metrics. Один вызов — все «сейчас»-числа. */
export async function getLiveMetrics(): Promise<LiveMetrics> {
  const since5 = new Date(Date.now() - ONLINE_WINDOW_MS)
  const [onlineRow, spendRow, credits, totals30, queueRows, today, onlineAll] = await Promise.all([
    db.select({ n: sql<number>`count(distinct ${sessions.userId})::int` }).from(sessions).where(gte(sessions.lastSeenAt, since5)),
    db.select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` }).from(aiUsage).where(gte(aiUsage.createdAt, DAY)),
    getOpenRouterCredits(),
    getUsageTotals(30),
    db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.type, 'generate')).groupBy(jobs.status),
    getTodayCounts(),
    getUmamiActive(),
  ])

  const queue = { pending: 0, processing: 0, failed: 0 }
  for (const r of queueRows) {
    if (r.status === 'pending') queue.pending = r.n
    else if (r.status === 'processing') queue.processing = r.n
    else if (r.status === 'failed') queue.failed = r.n
  }

  const avgPerGen = totals30.generations > 0 ? totals30.costUsd / totals30.generations : null
  const balance = credits?.remaining ?? null
  const runwayGens = balance != null && avgPerGen && avgPerGen > 0 ? Math.floor(balance / avgPerGen) : null

  return {
    onlineAuth: onlineRow[0]?.n ?? 0,
    onlineAll,
    umamiConfigured: umamiConfigured(),
    spendToday: spendRow[0]?.usd ?? 0,
    dailyCap: AI_DAILY_USD,
    balance,
    runwayGens,
    queue,
    today,
  }
}

// ── Дневные серии для графиков ──────────────────────────────────────────────
const dayExpr = (col: unknown) => sql<string>`to_char(date_trunc('day', ${col}), 'YYYY-MM-DD')`

function dayGrid(n: number): string[] {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
function toGrid(grid: string[], rows: { day: string; v: number }[]): number[] {
  const map = new Map(rows.map((r) => [r.day, Number(r.v)]))
  return grid.map((d) => map.get(d) ?? 0)
}

export async function getDashboardSeries(days = 14): Promise<DashboardSeries> {
  const grid = dayGrid(days)
  const since = new Date(grid[0] + 'T00:00:00Z')
  const [spendRows, genRows, tplRows, usrRows] = await Promise.all([
    db.select({ day: dayExpr(aiUsage.createdAt), v: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` }).from(aiUsage).where(gte(aiUsage.createdAt, since)).groupBy(sql`1`),
    db.select({ day: dayExpr(generations.createdAt), v: sql<number>`count(*)::int` }).from(generations).where(gte(generations.createdAt, since)).groupBy(sql`1`),
    db.select({ day: dayExpr(templates.createdAt), v: sql<number>`count(*)::int` }).from(templates).where(gte(templates.createdAt, since)).groupBy(sql`1`),
    db.select({ day: dayExpr(users.createdAt), v: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, since)).groupBy(sql`1`),
  ])
  return {
    days: grid,
    spend: toGrid(grid, spendRows),
    generations: toGrid(grid, genRows),
    newLists: toGrid(grid, tplRows),
    signups: toGrid(grid, usrRows),
  }
}
