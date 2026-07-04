import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { auditLog, db, users } from '@/shared/db'
import type { AuditAction } from '@/shared/audit'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorHandle: string | null
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown>
  ip: string | null
  createdAt: Date
}

/** Последние записи журнала аудита (для админа). LEFT JOIN — актор мог быть удалён. */
export async function getAuditLog(limit = 200): Promise<AuditEntry[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorHandle: users.handle,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      meta: auditLog.meta,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, action: r.action as AuditAction }))
}
