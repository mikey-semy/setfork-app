import { count, desc, eq } from 'drizzle-orm'
import { db, feedback, users } from '@/shared/db'

export type FeedbackFilter = 'all' | 'new' | 'seen' | 'done'

export interface FeedbackItem {
  id: string
  category: 'bug' | 'idea' | 'content' | 'legal' | 'other'
  body: string
  email: string
  pageUrl: string
  status: 'new' | 'seen' | 'done'
  createdAt: Date
  handle: string | null
}

export async function getFeedbackList(filter: FeedbackFilter, limit = 200): Promise<FeedbackItem[]> {
  return db
    .select({
      id: feedback.id,
      category: feedback.category,
      body: feedback.body,
      email: feedback.email,
      pageUrl: feedback.pageUrl,
      status: feedback.status,
      createdAt: feedback.createdAt,
      handle: users.handle,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(filter === 'all' ? undefined : eq(feedback.status, filter))
    .orderBy(desc(feedback.createdAt))
    .limit(limit)
}

export async function getFeedbackCounts(): Promise<Record<FeedbackFilter, number>> {
  const rows = await db
    .select({ status: feedback.status, n: count() })
    .from(feedback)
    .groupBy(feedback.status)
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
  const c = { new: by.new ?? 0, seen: by.seen ?? 0, done: by.done ?? 0 }
  return { all: c.new + c.seen + c.done, ...c }
}
