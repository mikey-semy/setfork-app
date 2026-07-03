import 'server-only'
import { asc, eq, sql } from 'drizzle-orm'
import { db, issues, milestones } from '@/shared/db'

export interface MilestoneRow {
  id: string
  title: string
  desc: string
  dueOn: Date | null
  closed: boolean
  openCount: number
  closedCount: number
}

/** Вехи списка с прогрессом (счётчики open/closed issue). Открытые — первыми, по сроку. */
export async function getMilestones(templateId: string): Promise<MilestoneRow[]> {
  const rows = await db
    .select({
      id: milestones.id,
      title: milestones.title,
      desc: milestones.desc,
      dueOn: milestones.dueOn,
      closed: milestones.closed,
      openCount: sql<number>`(select count(*)::int from ${issues} i where i.milestone_id = ${milestones.id} and i.status = 'open')`,
      closedCount: sql<number>`(select count(*)::int from ${issues} i where i.milestone_id = ${milestones.id} and i.status = 'closed')`,
    })
    .from(milestones)
    .where(eq(milestones.templateId, templateId))
    .orderBy(asc(milestones.closed), asc(milestones.dueOn), asc(milestones.title))
  return rows.map((r) => ({ ...r, openCount: Number(r.openCount), closedCount: Number(r.closedCount) }))
}

/** Заголовки вех для пикера на issue. */
export async function getMilestonesForPicker(templateId: string): Promise<{ id: string; title: string; closed: boolean }[]> {
  return db
    .select({ id: milestones.id, title: milestones.title, closed: milestones.closed })
    .from(milestones)
    .where(eq(milestones.templateId, templateId))
    .orderBy(asc(milestones.closed), asc(milestones.title))
}
