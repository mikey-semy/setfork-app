import 'server-only'
import { and, arrayOverlaps, asc, eq, exists, sql } from 'drizzle-orm'
import { db, runs, savedQueries, templates } from '@/shared/db'

/**
 * Сохранённые запросы (HQ §11, Dataview-аналог): фильтры к СВОИМ спискам —
 * теги (any-of) + статус прогона. Применение — на сервере /my-lists.
 */

export type RunState = 'any' | 'started' | 'done'

export interface SavedQuery {
  id: string
  name: string
  tags: string[]
  runState: RunState
}

const asRunState = (v: string): RunState => (v === 'started' || v === 'done' ? v : 'any')

export async function listSavedQueries(userId: string): Promise<SavedQuery[]> {
  const rows = await db
    .select()
    .from(savedQueries)
    .where(eq(savedQueries.userId, userId))
    .orderBy(asc(savedQueries.createdAt))
  return rows.map((r) => ({ id: r.id, name: r.name, tags: r.tags, runState: asRunState(r.runState) }))
}

/** id списков владельца, попадающих под запрос. null-запрос = без фильтра. */
export async function applySavedQuery(userId: string, q: SavedQuery): Promise<Set<string>> {
  const conds = [eq(templates.ownerId, userId)]
  if (q.tags.length) conds.push(arrayOverlaps(templates.tags, q.tags))
  if (q.runState !== 'any') {
    const wantDone = q.runState === 'done'
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(runs)
          .where(and(eq(runs.templateId, templates.id), eq(runs.userId, userId), wantDone ? eq(runs.status, 'done') : eq(runs.status, 'active'))),
      ),
    )
  }
  const rows = await db.select({ id: templates.id }).from(templates).where(and(...conds))
  return new Set(rows.map((r) => r.id))
}
