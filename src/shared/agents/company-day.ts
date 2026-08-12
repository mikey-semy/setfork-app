import 'server-only'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { agentActions, db, users } from '@/shared/db'

/**
 * ДЕНЬ КОМПАНИИ — что петли сделали за сутки, по журналу действий.
 *
 * Живёт в shared, потому что читают его двое: дашборд (показать) и летописец (отправить
 * владельцу), а фича из фичи у нас не импортируется. Считается КОДОМ из журнала: ни одного
 * вызова модели, ни одной оценки — только то, что действительно произошло.
 */

export interface CompanyDay {
  /** Смещение в днях: 0 = сегодня, 1 = вчера. */
  daysAgo: number
  created: number
  improved: number
  /** Правок ПРЕДЛОЖЕНО чужим спискам — для компании это самый частый исход прохода:
   *  своих списков у неё почти нет, а в чужой она пишет предложением, не версией. */
  proposed: number
  published: number
  held: number
  forked: number
  stable: number
  dryRun: number
  errors: number
  /** Топ-причины, по которым списки НЕ прошли планку (причина → сколько раз). */
  holdReasons: { reason: string; times: number }[]
  /** Последние события дня — человекочитаемой строкой. */
  events: { at: Date; action: string; status: string; ref: string; who: string; note: string }[]
}

const ACTION_LABEL: Record<string, keyof Pick<CompanyDay, 'created' | 'improved' | 'proposed' | 'published' | 'held' | 'forked' | 'stable'>> = {
  'list.draft': 'created',
  'list.improve': 'improved',
  'list.suggest': 'proposed',
  'list.publish': 'published',
  'list.hold': 'held',
  'list.fork': 'forked',
  'list.stable': 'stable',
}

/** Первая строка-причина из решения гейта (их может быть несколько — берём главную). */
function mainBlocker(decision: unknown): string {
  const b = (decision as { blockers?: unknown })?.blockers
  if (!Array.isArray(b) || !b.length) return ''
  return String(b[0]).slice(0, 120)
}

export async function getCompanyDay(daysAgo = 0): Promise<CompanyDay> {
  // Границы = серверные сутки Postgres со сдвигом: та же арифметика, что у суточных капов.
  const rows = await db
    .select({
      action: agentActions.action,
      status: agentActions.resultStatus,
      ref: agentActions.resultRef,
      agentId: agentActions.agentId,
      decision: agentActions.decision,
      error: agentActions.error,
      at: agentActions.occurredAt,
    })
    .from(agentActions)
    .where(
      sql`${agentActions.occurredAt} >= date_trunc('day', now()) - (${daysAgo}::int * interval '1 day')
          and ${agentActions.occurredAt} < date_trunc('day', now()) - ((${daysAgo}::int - 1) * interval '1 day')`,
    )
    .orderBy(desc(agentActions.occurredAt))
    .limit(500)

  const day: CompanyDay = {
    daysAgo,
    created: 0, improved: 0, proposed: 0, published: 0, held: 0, forked: 0, stable: 0, dryRun: 0, errors: 0,
    holdReasons: [],
    events: [],
  }
  const reasons = new Map<string, number>()
  for (const r of rows) {
    if (r.status === 'dry-run') day.dryRun++
    if (r.status === 'error') day.errors++
    const key = ACTION_LABEL[r.action]
    if (key && r.status !== 'dry-run') day[key]++
    if (r.action === 'list.hold') {
      const reason = mainBlocker(r.decision)
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    if (day.events.length < 40) {
      day.events.push({
        at: r.at,
        action: r.action,
        status: r.status,
        ref: r.ref,
        who: r.agentId,
        note: r.action === 'list.hold' ? mainBlocker(r.decision) : r.error,
      })
    }
  }
  day.holdReasons = [...reasons.entries()].map(([reason, times]) => ({ reason, times })).sort((a, b) => b.times - a.times).slice(0, 6)
  return day
}

