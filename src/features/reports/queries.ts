import { count, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, contentReports, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

export type ReportFilter = 'all' | 'new' | 'reviewed' | 'actioned' | 'dismissed'

export interface ReportItem {
  id: string
  reason: 'illegal' | 'spam' | 'copyright' | 'privacy' | 'other'
  body: string
  email: string
  status: 'new' | 'reviewed' | 'actioned' | 'dismissed'
  createdAt: Date
  reporterHandle: string | null
  listTitle: LocaleText
  listSlug: string
  ownerHandle: string | null
}

const owners = alias(users, 'owners')

export async function getReportsList(filter: ReportFilter, limit = 200): Promise<ReportItem[]> {
  return db
    .select({
      id: contentReports.id,
      reason: contentReports.reason,
      body: contentReports.body,
      email: contentReports.email,
      status: contentReports.status,
      createdAt: contentReports.createdAt,
      reporterHandle: users.handle,
      listTitle: templates.title,
      listSlug: templates.slug,
      ownerHandle: owners.handle,
    })
    .from(contentReports)
    .innerJoin(templates, eq(templates.id, contentReports.templateId))
    .leftJoin(users, eq(users.id, contentReports.reporterUserId))
    .leftJoin(owners, eq(owners.id, templates.ownerId))
    .where(filter === 'all' ? undefined : eq(contentReports.status, filter))
    .orderBy(desc(contentReports.createdAt))
    .limit(limit)
}

export async function getReportsCounts(): Promise<Record<ReportFilter, number>> {
  const rows = await db
    .select({ status: contentReports.status, n: count() })
    .from(contentReports)
    .groupBy(contentReports.status)
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
  const c = {
    new: by.new ?? 0,
    reviewed: by.reviewed ?? 0,
    actioned: by.actioned ?? 0,
    dismissed: by.dismissed ?? 0,
  }
  return { all: c.new + c.reviewed + c.actioned + c.dismissed, ...c }
}
