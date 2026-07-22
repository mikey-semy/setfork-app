import 'server-only'
import { headers } from 'next/headers'
import { auditLog, db } from '@/shared/db'
import { captureError } from '@/shared/observability'

// Журнал аудита: кто что сделал с чувствительными объектами (токены, списки,
// пуши, сессии, модерация). Best-effort — не роняет вызывающего.
export type AuditAction =
  | 'token.create'
  | 'token.revoke'
  | 'list.delete'
  | 'list.moderate'
  | 'list.appeal'
  | 'list.report'
  | 'list.verify'
  | 'git.push'
  | 'session.revoke'
  | 'session.revoke_others'
  | '2fa.enable'
  | '2fa.disable'
  | '2fa.recovery-regenerate'
  | 'maintenance.on'
  | 'maintenance.off'
  | 'monetization.settings'
  | 'password.reset'
  | 'email.change-request'
  | 'email.change'
  | 'passkey.add'
  | 'passkey.remove'
  | 'passkey.login'
  | 'account.delete'
  | 'account.handle-change'

export async function recordAudit(
  action: AuditAction,
  opts: {
    actorId?: string | null
    targetType?: string
    targetId?: string
    meta?: Record<string, unknown>
    ip?: string | null
  } = {},
): Promise<void> {
  try {
    let ip = opts.ip
    if (ip === undefined) {
      // headers() доступен только в request-контексте (server actions / route handlers).
      const h = await headers().catch(() => null)
      ip = h ? (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null : null
    }
    await db.insert(auditLog).values({
      actorId: opts.actorId ?? null,
      action,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      meta: opts.meta ?? {},
      ip: ip ?? null,
    })
  } catch (e) {
    captureError(e, { where: 'recordAudit', action })
  }
}
