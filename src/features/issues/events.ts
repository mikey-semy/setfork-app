import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { db, issueEvents, suggestions, users, type Executor } from '@/shared/db'

/**
 * ЛЕНТА ЗАДАЧИ ПОМНИТ, КТО ЕЁ ЗАКРЫЛ И ЧЕМ.
 *
 * Закрытие не оставляло следа: задача просто становилась закрытой. Кто, когда и почему —
 * узнать было негде, а у закрытой принятой правкой не было видно, какой именно, хотя
 * это первое, что спрашивают.
 *
 * ⚠️ ПОРЯДОК: СНАЧАЛА СТАТУС, ПОТОМ СОБЫТИЕ. Одной транзакцией их не связать: статус
 * меняет хранилище задач, а оно бывает и ядром по gRPC — общей транзакции с нашей базой
 * у них нет. Значит окно между двумя записями существует, и вопрос лишь в том, какая
 * половина уцелеет при обрыве. Статус без события — задача закрыта, в ленте пусто:
 * неполно, но правда. Событие без статуса — лента утверждает, что задачу закрыли, а она
 * открыта: это уже ложь, и разбираться с ней будет тот, кто её увидит.
 */
export interface IssueEvent {
  id: string
  kind: 'closed' | 'reopened' | 'closed_by_suggestion' | 'locked' | 'unlocked'
  /** Причина запирания — только у `locked`; в ленте она остаётся и после отпирания. */
  lockReason?: 'off_topic' | 'too_heated' | 'resolved' | 'spam' | null
  createdAt: Date
  actorHandle: string
  actorAvatarUrl: string | null
  /** Правка, из-за которой задача закрылась: номер для подписи, id для ссылки. */
  suggestion: { id: string; number: number | null } | null
}

export async function recordIssueEvent(
  exec: Executor,
  event: {
    issueId: string
    actorId: string
    kind: IssueEvent['kind']
    suggestionId?: string
    lockReason?: IssueEvent['lockReason']
  },
): Promise<void> {
  await exec.insert(issueEvents).values({
    issueId: event.issueId,
    actorId: event.actorId,
    kind: event.kind,
    suggestionId: event.suggestionId ?? null,
    lockReason: event.lockReason ?? null,
  })
}

/**
 * События задачи — все сразу, без листания.
 *
 * Их единицы там, где реплик бывают тысячи: закрыл, переоткрыл, закрыл снова. Листать
 * нечего, а вот вклеить их в нужные места треда можно, только имея все.
 */
export async function getIssueEvents(issueId: string): Promise<IssueEvent[]> {
  const rows = await db
    .select({
      id: issueEvents.id,
      kind: issueEvents.kind,
      createdAt: issueEvents.createdAt,
      actorHandle: users.handle,
      actorAvatarUrl: users.avatarUrl,
      suggestionId: issueEvents.suggestionId,
      suggestionNumber: suggestions.number,
      lockReason: issueEvents.lockReason,
    })
    .from(issueEvents)
    .innerJoin(users, eq(issueEvents.actorId, users.id))
    // ⚠️ leftJoin: правку могли удалить, и тогда `suggestion_id` обнулился. Событие при
    // этом остаётся — задачу действительно закрыли, — и внутренний join потерял бы его.
    .leftJoin(suggestions, eq(issueEvents.suggestionId, suggestions.id))
    .where(eq(issueEvents.issueId, issueId))
    .orderBy(asc(issueEvents.createdAt), asc(issueEvents.id))

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    createdAt: r.createdAt,
    actorHandle: r.actorHandle,
    actorAvatarUrl: r.actorAvatarUrl,
    lockReason: r.lockReason,
    suggestion: r.suggestionId ? { id: r.suggestionId, number: r.suggestionNumber } : null,
  }))
}
