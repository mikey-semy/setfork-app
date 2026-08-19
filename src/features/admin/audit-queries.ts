import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { auditLog, db, users } from '@/shared/db'
import { cursorKey, keysetStep } from '@/shared/db/keyset'
import { encodeCursor, probeLimit, takePage, type Cursor, type FeedDirection } from '@/shared/lib/paging'
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
/**
 * ЖУРНАЛ АУДИТА ПОРЦИЯМИ — ключом, а не номером страницы.
 *
 * Фаза 2 трека числит админку по себе, но механику диктует ФОРМА ДАННЫХ, а не номер
 * фазы: журнал пополняется СВЕРХУ непрерывно, а читают его сверху вниз. На такой ленте
 * смещение даёт не медленную выдачу, а неверную — пока админ смотрит вторую порцию,
 * начало отсчёта уезжает вниз, и запись с границы либо пропадает, либо приходит дважды.
 * В журнале аудита это хуже, чем в любой другой ленте: пропущенная запись означает
 * «действия не было».
 *
 * Раньше журнал обрезался на 200 записях ЖЁСТКО и молча: всё, что старше, увидеть было
 * нельзя вовсе.
 */
export async function getAuditLogPage(
  perPage: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
): Promise<{ items: AuditEntry[]; next: string | null; prev: string | null }> {
  // Без курсора шага назад не существует: «перед началом» — не место.
  const back = dir === 'before' && cursor !== null
  const step = keysetStep(auditLog.createdAt, auditLog.id, cursor, { order: 'desc', dir: back ? 'before' : 'after' })
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
      // Ключ ТЕКСТОМ: типизированная колонка приезжает без микросекунд (shared/db/keyset).
      cursorKey: cursorKey(auditLog.createdAt),
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .where(step.where)
    .orderBy(...step.order)
    .limit(probeLimit(perPage))

  // Отсекаем лишнюю строку разведчика ДО разворота — иначе отрезался бы не тот конец.
  const { items: taken, hasNext: more } = takePage(rows, perPage)
  const shown = step.reverse ? [...taken].reverse() : taken
  const at = (row: (typeof shown)[number] | undefined): string | null =>
    row ? encodeCursor({ key: row.cursorKey, id: row.id }) : null
  return {
    items: shown.map(({ cursorKey: _k, ...r }) => ({ ...r, action: r.action as AuditAction })),
    next: back ? at(shown[shown.length - 1]) : more ? at(shown[shown.length - 1]) : null,
    prev: back ? (more ? at(shown[0]) : null) : cursor ? at(shown[0]) : null,
  }
}

/** Журнал целиком до предела — для выгрузок и служебных нужд, не для страницы. */
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
    // Доопределение до `id`: у записей одной операции время совпадает.
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
  return rows.map((r) => ({ ...r, action: r.action as AuditAction }))
}
