import 'server-only'
import { auditLog, db } from '@/shared/db'
import { captureError } from '@/shared/observability'
import { requestIp } from '@/shared/request-ip'

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
  | 'list.transfer-init'
  | 'list.transfer-accept'
  | 'git.push'
  // Ф4: предложение предъявлено из терминала магическим рефом refs/for/main.
  // Отдельно от 'git.push': тот про версию в main, а это про правку к нему.
  | 'git.suggest'
  // Замер спроса на Pro (0021): заявка без платёжки. В журнале, потому что по этим
  // числам принимается решение о деньгах — оно должно быть прослеживаемым.
  | 'pro.interest'
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
  // Способы входа: привязка и отвязка провайдера к уже вошедшему аккаунту. В журнале
  // обязательны оба — это изменение того, КТО может войти под этим профилем.
  | 'auth.identity-link'
  | 'auth.identity-unlink'


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
    const ip = opts.ip === undefined ? await requestIp() : opts.ip
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

/**
 * Аудит ПАЧКИ однотипных действий — одной вставкой.
 *
 * Массовое одобрение в модерации писало журнал по строке на список, и каждая строка
 * заново спрашивала заголовки запроса ради IP. На двух сотнях списков это две сотни
 * последовательных вставок там, где хватает одной (указано react-doctor). IP и время
 * у пачки общие по смыслу: это одно нажатие одного человека.
 *
 * Пустой список — не запись: вставка без строк упала бы, а «ничего не произошло» и
 * журналировать нечего.
 */
export async function recordAuditMany(
  action: AuditAction,
  rows: { actorId?: string | null; targetType?: string; targetId?: string; meta?: Record<string, unknown> }[],
): Promise<void> {
  if (rows.length === 0) return
  try {
    const ip = await requestIp()
    await db.insert(auditLog).values(
      rows.map((r) => ({
        actorId: r.actorId ?? null,
        action,
        targetType: r.targetType ?? null,
        targetId: r.targetId ?? null,
        meta: r.meta ?? {},
        ip,
      })),
    )
  } catch (e) {
    captureError(e, { where: 'recordAuditMany', action })
  }
}
