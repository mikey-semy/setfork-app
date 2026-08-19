import { desc } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodeCursor } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЖУРНАЛ АУДИТА — ключом, а не номером страницы.
 *
 * Трек числит админку по Фазе 2 (номера), но механику диктует форма данных: журнал
 * пополняется СВЕРХУ непрерывно, а читают его сверху вниз. Это лента, и смещение на ней
 * даёт не медленную выдачу, а неверную. Здесь цена ошибки выше, чем в любой другой
 * ленте: пропущенная запись читается как «действия не было».
 *
 * Раньше журнал обрезался на 200 записях жёстко и молча — всё, что старше, увидеть было
 * нельзя вовсе.
 */

const { auditLog, db, users } = await import('@/shared/db')
const { getAuditLogPage } = await import('@/features/admin/audit-queries')

const COUNT = 7
const PER = 3

const idsOf = (p: { items: { id: string }[] }): string[] => p.items.map((e) => e.id)

const seed = async (from: number, n: number): Promise<void> => {
  await db.insert(auditLog).values(
    Array.from({ length: n }, (_, i) => ({
      action: 'user.role_changed',
      targetType: 'user',
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, from + i)),
    })),
  )
}

beforeEach(async () => {
  await resetTables([auditLog, users])
  await seed(0, COUNT)
})

describe('журнал аудита листается ключом', () => {
  it('обход порциями даёт весь журнал без повторов', async () => {
    const seen: string[] = []
    let cursor = null as ReturnType<typeof decodeCursor>
    for (let i = 0; i < 10; i++) {
      const page = await getAuditLogPage(PER, cursor)
      seen.push(...page.items.map((e) => e.id))
      if (!page.next) break
      cursor = decodeCursor(page.next)
    }
    expect(seen).toHaveLength(COUNT)
    expect(new Set(seen).size).toBe(COUNT)
  })

  it('свежие записи сверху', async () => {
    const { items } = await getAuditLogPage(COUNT)
    const times = items.map((e) => new Date(e.createdAt).getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('ДЕФЕКТ РЕАЛЕН: смещение показывает запись дважды, когда журнал пополнили', async () => {
    const byOffset = async (offset: number): Promise<string[]> =>
      (
        await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(PER)
          .offset(offset)
      ).map((r) => r.id)

    const firstPage = await byOffset(0)
    await seed(100, 2) // администратор что-то сделал, пока читали журнал
    const secondPage = await byOffset(PER)
    expect(secondPage.filter((id) => firstPage.includes(id))).not.toHaveLength(0)
  })

  it('KEYSET ЭТОГО НЕ ДАЁТ: та же вставка сверху не сдвигает выдачу', async () => {
    const first = await getAuditLogPage(PER)
    const firstIds = first.items.map((e) => e.id)
    await seed(100, 2)
    const second = await getAuditLogPage(PER, decodeCursor(first.next))
    expect(second.items.map((e) => e.id).filter((id) => firstIds.includes(id))).toHaveLength(0)
  })

  it('шаг назад возвращает ровно ту порцию, с которой ушли', async () => {
    const first = await getAuditLogPage(PER)
    expect(first.prev).toBeNull() // у начала журнала шага вверх нет
    const second = await getAuditLogPage(PER, decodeCursor(first.next))
    const back = await getAuditLogPage(PER, decodeCursor(second.prev), 'before')
    expect(back.items.map((e) => e.id)).toEqual(idsOf(first))
  })

  it('«назад» без курсора не открывает журнал с конца', async () => {
    const start = await getAuditLogPage(PER)
    const bogus = await getAuditLogPage(PER, null, 'before')
    expect(bogus.items.map((e) => e.id)).toEqual(idsOf(start))
  })

  it('порция за краем ленты — НЕ тупик: назад увести обязано', async () => {
    // Ссылку на порцию сохранили, а строки с тех пор удалили — курсор указывает за край.
    // Выдача приходит пустой, и построить шаги из показанных строк не из чего. Раньше оба
    // шага оказывались null: листалка не рисовалась, и из ленты было НЕ ВЫБРАТЬСЯ вовсе.
    const p1 = await getAuditLogPage(PER)
    const p2 = await getAuditLogPage(PER, decodeCursor(p1.next))
    const p3 = await getAuditLogPage(PER, decodeCursor(p2.next))
    // p3.prev — курсор первой показанной строки последней порции; шаг «дальше» от нижней
    // строки ленты даёт пустоту.
    const bottom = await getAuditLogPage(PER, decodeCursor(p3.prev), 'after')
    const past = await getAuditLogPage(PER, decodeCursor(bottom.next ?? p3.prev), 'after')

    expect(past.items).toHaveLength(0)
    expect(past.prev).not.toBeNull()
    // И шаг назад обязан привести к настоящим строкам, а не в ту же пустоту.
    const back = await getAuditLogPage(PER, decodeCursor(past.prev), 'before')
    expect(back.items.length).toBeGreaterThan(0)
  })

  it('записи старше двухсотой ДОСТИЖИМЫ — раньше их не было видно вовсе', async () => {
    await resetTables([auditLog])
    await seed(0, 250)
    let cursor = null as ReturnType<typeof decodeCursor>
    let seen = 0
    for (let i = 0; i < 10; i++) {
      const page = await getAuditLogPage(50, cursor)
      seen += page.items.length
      if (!page.next) break
      cursor = decodeCursor(page.next)
    }
    expect(seen).toBe(250)
  })
})
