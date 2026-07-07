import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, pollVotes } from '@/shared/db'

export interface PollResult {
  counts: Record<string, number> // optionId → число голосов
  voters: number // сколько РАЗНЫХ людей проголосовало (для %)
  myVotes: string[] // optionId, за которые голосовал текущий зритель
}

/** Результаты poll-блоков списка по их bid: счётчики + голоса текущего зрителя. */
export async function getPollResults(templateId: string, bids: string[], userId?: string): Promise<Record<string, PollResult>> {
  const out: Record<string, PollResult> = {}
  const uniq = [...new Set(bids)].filter(Boolean)
  for (const b of uniq) out[b] = { counts: {}, voters: 0, myVotes: [] }
  if (!uniq.length) return out

  const counts = await db
    .select({ bid: pollVotes.bid, optionId: pollVotes.optionId, c: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(and(eq(pollVotes.templateId, templateId), inArray(pollVotes.bid, uniq)))
    .groupBy(pollVotes.bid, pollVotes.optionId)
  for (const r of counts) if (out[r.bid]) out[r.bid].counts[r.optionId] = r.c

  const voters = await db
    .select({ bid: pollVotes.bid, n: sql<number>`count(distinct ${pollVotes.userId})::int` })
    .from(pollVotes)
    .where(and(eq(pollVotes.templateId, templateId), inArray(pollVotes.bid, uniq)))
    .groupBy(pollVotes.bid)
  for (const r of voters) if (out[r.bid]) out[r.bid].voters = r.n

  if (userId) {
    const mine = await db
      .select({ bid: pollVotes.bid, optionId: pollVotes.optionId })
      .from(pollVotes)
      .where(and(eq(pollVotes.templateId, templateId), inArray(pollVotes.bid, uniq), eq(pollVotes.userId, userId)))
    for (const r of mine) if (out[r.bid]) out[r.bid].myVotes.push(r.optionId)
  }
  return out
}
