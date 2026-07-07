import 'server-only'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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

export interface PollHistoryEvent {
  t: number // ms — момент, когда голос был отдан (createdAt)
  optionId: string
}

// Максимум событий в ответе — защита от гигантских опросов (клиент строит
// накопительные линии; для распознавания «вброса» этого с запасом хватает).
const HISTORY_CAP = 3000

/** Хронология голосов poll-блока (динамика во времени — как в Telegram: видно
 *  всплеск одного варианта = «вброс»). NB: poll_votes хранит только ТЕКУЩИЕ
 *  голоса (смена голоса удаляет прежний), поэтому это динамика стоящих голосов,
 *  а не полная история переголосований — но кластер по времени всё равно виден. */
export async function getPollHistory(templateId: string, bid: string): Promise<{ events: PollHistoryEvent[] }> {
  if (!bid) return { events: [] }
  const rows = await db
    .select({ optionId: pollVotes.optionId, createdAt: pollVotes.createdAt })
    .from(pollVotes)
    .where(and(eq(pollVotes.templateId, templateId), eq(pollVotes.bid, bid)))
    .orderBy(asc(pollVotes.createdAt))
    .limit(HISTORY_CAP)
  return { events: rows.map((r) => ({ t: r.createdAt.getTime(), optionId: r.optionId })) }
}
