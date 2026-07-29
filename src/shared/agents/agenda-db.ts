import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { agendaItems, db } from '@/shared/db'

/**
 * ЧТЕНИЕ ПОВЕСТКИ для производства. Живёт в shared по той же причине, что и выбор материала из
 * потока: пишет повестку одна фича (партнёры), а читает другая (производство) — фича из фичи у
 * нас не импортируется.
 *
 * Одобренные темы производство ставит впереди очереди: именно здесь решение гендиректора
 * доходит до работы, а не остаётся отметкой в интерфейсе.
 */
/**
 * ХОЗЯЕВА одобренных пунктов. Производство обязано читать именно их: без этого «один владелец
 * на задачу» остаётся записью в базе — очередь выбрала бы исполнителя своими правилами, и
 * отвечал бы за тему один, а делал другой (находка ревью на #558).
 */
export async function approvedOwners(limit = 10): Promise<string[]> {
  const rows = await db
    .select({ owner: agendaItems.ownerExpertId })
    .from(agendaItems)
    .where(and(eq(agendaItems.status, 'approved'), inArray(agendaItems.kind, ['deepen', 'canon'])))
    .orderBy(desc(agendaItems.score))
    .limit(limit)
  return rows.map((r) => r.owner ?? '').filter(Boolean)
}

export async function approvedDomains(limit = 10): Promise<string[]> {
  const rows = await db
    .select({ domain: agendaItems.domain })
    .from(agendaItems)
    .where(and(eq(agendaItems.status, 'approved'), inArray(agendaItems.kind, ['deepen', 'canon'])))
    .orderBy(desc(agendaItems.score))
    .limit(limit)
  return rows.map((r) => r.domain).filter(Boolean)
}
