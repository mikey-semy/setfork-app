import { eq, like } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordAudit, recordAuditMany } from '@/shared/audit'
import { auditLog, db } from '@/shared/db'

// Отказ СИНХРОННЫМ броском — тот вид, который `.catch` не ловит. Подделывается здесь
// намеренно: в чистом тестовом окружении `headers()` отклоняет промис, и проверка,
// опирающаяся только на него, пропустила бы возврат к `.catch` (мутация это показала).
vi.mock('next/headers', () => ({
  headers: () => {
    throw new Error('`headers` was called outside a request scope')
  },
}))

/**
 * ЖУРНАЛ ПИШЕТСЯ И ТАМ, ГДЕ ЗАПРОСА НЕТ.
 *
 * IP берётся из заголовков, а вне области запроса `headers()` отказывает — и отказ
 * приходит по-разному: то отклонённым промисом, то синхронным броском. `.catch`
 * покрывает только первый вид, и на втором исключение улетало в общий перехват,
 * отменяя запись целиком: событие терялось молча.
 *
 * Теряло оно ровно те места, где человека рядом нет и заметить некому: очередь задач,
 * приём git-push, инструменты MCP. Здесь проверяется оба пути — одиночный и пакетный, —
 * причём тест НЕ подделывает request-scope: его отсутствие и есть условие проверки.
 */
const target = (n: string) => `outside-request-${n}`

// Журнал НИКОГДА не чистится приложением — он на то и журнал. Значит убирать за собой
// обязан тест, иначе второй прогон видит записи первого и падает на счёте.
beforeEach(async () => {
  await db.delete(auditLog).where(like(auditLog.targetId, 'outside-request-%'))
})

describe('аудит вне области запроса', () => {
  it('одиночная запись доходит', async () => {
    await recordAudit('list.moderate', { targetType: 'list', targetId: target('one') })
    const rows = await db.select({ ip: auditLog.ip }).from(auditLog).where(eq(auditLog.targetId, target('one')))
    expect(rows).toHaveLength(1)
    // IP взять неоткуда — это законно; отсутствие адреса не повод терять событие.
    expect(rows[0].ip).toBeNull()
  })

  it('пакетная запись доходит целиком', async () => {
    const ids = ['a', 'b', 'c'].map((s) => target(s))
    await recordAuditMany(
      'list.moderate',
      ids.map((id) => ({ targetType: 'list', targetId: id })),
    )
    for (const id of ids) {
      const rows = await db.select({ t: auditLog.targetId }).from(auditLog).where(eq(auditLog.targetId, id))
      expect(rows, id).toHaveLength(1)
    }
  })
})
