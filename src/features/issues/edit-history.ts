import 'server-only'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { contentEdits, db } from '@/shared/db'
import type { ContentRevision } from './edit-actions'

/**
 * История правок сразу для задачи и всех реплик страницы — ОДНИМ запросом.
 *
 * По запросу на карточку это N+1 на треде из двадцати реплик, и цена растёт вместе с
 * обсуждением. Тот же приём уже применён к реакциям на этой же странице.
 */
export async function contentHistoryFor(
  targets: { kind: 'issue' | 'comment'; id: string }[],
): Promise<Record<string, ContentRevision[]>> {
  const out: Record<string, ContentRevision[]> = {}
  const ids = targets.map((t) => t.id)
  if (!ids.length) return out

  const rows = await db
    .select({
      id: contentEdits.id,
      targetId: contentEdits.targetId,
      editorId: contentEdits.editorId,
      prevTitle: contentEdits.prevTitle,
      prevBody: contentEdits.prevBody,
      createdAt: contentEdits.createdAt,
    })
    .from(contentEdits)
    .where(inArray(contentEdits.targetId, ids))
    .orderBy(desc(contentEdits.createdAt))

  for (const r of rows) (out[r.targetId] ??= []).push(r)
  return out
}
