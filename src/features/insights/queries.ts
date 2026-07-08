import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import { db, linkClicks, runs, stars, templates, templateVersions, templateViews, watches } from '@/shared/db'

// Insights списка: недельные серии и итоги. Серии считаем на фиксированной
// сетке последних N недель (date_trunc('week')) — пустые недели заполняем нулями.

export const WEEKS = 12

export interface WeeklySeries {
  weeks: string[] // ISO-даты понедельников, старые → новые
  stars: number[]
  forks: number[]
  runs: number[]
  versions: number[]
  views: number[] // уникальные дневные просмотры (см. template_views)
  clicks: number[] // клики по внешним ссылкам (/api/go)
}

export interface InsightTotals {
  stars: number
  forks: number
  runs: number
  watchers: number
  versions: number
  uniqueRunners: number
  runsDone: number
  views: number
  clicks: number
}

function weekGrid(n: number): string[] {
  // Понедельник текущей недели (UTC) и n-1 назад.
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7 // 0 = понедельник
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(monday)
    d.setUTCDate(monday.getUTCDate() - i * 7)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** count по неделям для произвольной таблицы: [{week: 'YYYY-MM-DD', c}] → сетка. */
function toGrid(grid: string[], rows: { week: string; c: number }[]): number[] {
  const map = new Map(rows.map((r) => [r.week, r.c]))
  return grid.map((w) => map.get(w) ?? 0)
}

const weekExpr = (col: unknown) => sql<string>`to_char(date_trunc('week', ${col}), 'YYYY-MM-DD')`

export async function getWeeklySeries(templateId: string): Promise<WeeklySeries> {
  const grid = weekGrid(WEEKS)
  const since = new Date(grid[0] + 'T00:00:00Z')

  const [starRows, forkRows, runRows, versionRows, viewRows, clickRows] = await Promise.all([
    db
      .select({ week: weekExpr(stars.createdAt), c: sql<number>`count(*)::int` })
      .from(stars)
      .where(and(eq(stars.templateId, templateId), gte(stars.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({ week: weekExpr(templates.createdAt), c: sql<number>`count(*)::int` })
      .from(templates)
      .where(and(eq(templates.forkedFromId, templateId), gte(templates.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({ week: weekExpr(runs.startedAt), c: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.templateId, templateId), gte(runs.startedAt, since)))
      .groupBy(sql`1`),
    db
      .select({ week: weekExpr(templateVersions.createdAt), c: sql<number>`count(*)::int` })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, templateId), gte(templateVersions.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({ week: weekExpr(templateViews.createdAt), c: sql<number>`count(*)::int` })
      .from(templateViews)
      .where(and(eq(templateViews.templateId, templateId), gte(templateViews.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({ week: weekExpr(linkClicks.createdAt), c: sql<number>`count(*)::int` })
      .from(linkClicks)
      .where(and(eq(linkClicks.templateId, templateId), gte(linkClicks.createdAt, since)))
      .groupBy(sql`1`),
  ])

  return {
    weeks: grid,
    stars: toGrid(grid, starRows),
    forks: toGrid(grid, forkRows),
    runs: toGrid(grid, runRows),
    versions: toGrid(grid, versionRows),
    views: toGrid(grid, viewRows),
    clicks: toGrid(grid, clickRows),
  }
}

export async function getInsightTotals(templateId: string): Promise<InsightTotals> {
  const [[star], [fork], [run], [watch], [ver], [view], [click]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(stars).where(eq(stars.templateId, templateId)),
    db.select({ c: sql<number>`count(*)::int` }).from(templates).where(eq(templates.forkedFromId, templateId)),
    db
      .select({
        c: sql<number>`count(*)::int`,
        u: sql<number>`count(distinct ${runs.userId})::int`,
        d: sql<number>`count(*) filter (where ${runs.status} = 'done')::int`,
      })
      .from(runs)
      .where(eq(runs.templateId, templateId)),
    db.select({ c: sql<number>`count(*)::int` }).from(watches).where(eq(watches.templateId, templateId)),
    db.select({ c: sql<number>`count(*)::int` }).from(templateVersions).where(eq(templateVersions.templateId, templateId)),
    db.select({ c: sql<number>`count(*)::int` }).from(templateViews).where(eq(templateViews.templateId, templateId)),
    db.select({ c: sql<number>`count(*)::int` }).from(linkClicks).where(eq(linkClicks.templateId, templateId)),
  ])
  return {
    stars: star?.c ?? 0,
    forks: fork?.c ?? 0,
    runs: run?.c ?? 0,
    uniqueRunners: run?.u ?? 0,
    runsDone: run?.d ?? 0,
    watchers: watch?.c ?? 0,
    versions: ver?.c ?? 0,
    views: view?.c ?? 0,
    clicks: click?.c ?? 0,
  }
}
