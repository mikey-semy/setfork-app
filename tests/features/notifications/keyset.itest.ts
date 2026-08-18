import { desc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { decodeCursor } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * KEYSET НА ЛЕНТЕ УВЕДОМЛЕНИЙ — проверяем то, ради чего его и вводили.
 *
 * Обычный тест устойчивости («обход по одной строке даёт корпус без повторов») здесь
 * недостаточен: смещение проходит его тоже, потому что данные во время обхода не менялись.
 * Вся разница между offset и keyset видна ровно в одном опыте — ДОБАВИТЬ СТРОКИ СВЕРХУ
 * ПОСЕРЕДИНЕ ЧТЕНИЯ. Тогда у offset начало отсчёта уезжает вниз, и строка с границы
 * приходит второй раз, а у keyset «дай строго после вот этой» отвечает одинаково, сколько
 * бы сверху ни добавили.
 *
 * Поэтому здесь два теста подряд: первый показывает, что дефект РЕАЛЕН (offset на тех же
 * данных действительно дублирует), второй — что keyset его не даёт. Без первого второй
 * доказывает только «код работает», но не «работает лучше».
 */

const { db, notifications, users } = await import('@/shared/db')
const { getNotificationsPage } = await import('@/features/notifications/queries')

const COUNT = 7
const PER = 3
let userId = ''

/** Уведомления с РАЗНЫМ временем: свежие сверху, как в жизни. */
const seed = async (from: number, n: number): Promise<void> => {
  await db.insert(notifications).values(
    Array.from({ length: n }, (_, i) => ({
      recipientId: userId,
      type: 'star' as const,
      // Секунда на строку: порядок однозначен и без доопределения, а проверяем мы здесь
      // не его, а поведение окна при вставке сверху.
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, from + i)),
    })),
  )
}

beforeAll(async () => {
  await resetTables([notifications, users])
  const [u] = await db.insert(users).values({ handle: 'keyset-reader' }).returning({ id: users.id })
  userId = u.id
  await seed(0, COUNT)
})

describe('лента уведомлений листается ключом', () => {
  it('обход порциями даёт всю ленту без повторов', async () => {
    const seen: string[] = []
    let cursor = null as ReturnType<typeof decodeCursor>
    for (let i = 0; i < 10; i++) {
      const page = await getNotificationsPage(userId, PER, cursor)
      seen.push(...page.items.map((n) => n.id))
      if (!page.next) break
      cursor = decodeCursor(page.next)
      expect(cursor).not.toBeNull()
    }
    expect(seen).toHaveLength(COUNT)
    expect(new Set(seen).size).toBe(COUNT)
  })

  it('порядок — свежие сверху', async () => {
    const { items } = await getNotificationsPage(userId, COUNT)
    const times = items.map((n) => new Date(n.createdAt).getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('ДЕФЕКТ РЕАЛЕН: смещение на пополняемой ленте показывает строку дважды', async () => {
    // Смещение берём прямым запросом, а не через getNotificationsPage: тот его больше не
    // предлагает, а показать надо именно МЕХАНИКУ, от которой ушли. Без этого теста
    // следующий доказывает лишь «код работает», но не «работает лучше».
    const byOffset = async (offset: number): Promise<string[]> =>
      (
        await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.recipientId, userId))
          .orderBy(desc(notifications.createdAt), desc(notifications.id))
          .limit(PER)
          .offset(offset)
      ).map((r) => r.id)

    const firstPage = await byOffset(0)
    await seed(100, 2) // сверху прилетели два новых уведомления
    const secondPage = await byOffset(PER)
    // Пересечение НЕПУСТО: начало отсчёта уехало вниз на два, и строки с первой страницы
    // приехали на вторую. Это и есть «offset не медленный, а неверный».
    expect(secondPage.filter((id) => firstPage.includes(id))).not.toHaveLength(0)
  })

  it('шаг назад возвращает ровно ту порцию, с которой ушли', async () => {
    await resetTables([notifications])
    await seed(0, COUNT)
    const first = await getNotificationsPage(userId, PER)
    expect(first.prev).toBeNull() // у начала ленты шага вверх нет

    const second = await getNotificationsPage(userId, PER, decodeCursor(first.next))
    expect(second.prev).not.toBeNull()

    const backAgain = await getNotificationsPage(userId, PER, decodeCursor(second.prev), 'before')
    expect(backAgain.items.map((n) => n.id)).toEqual(first.items.map((n) => n.id))
  })

  it('шаг назад отрезает БЛИЖНИЙ конец, а не дальний', async () => {
    // Строки шага вверх приходят от курсора вверх, то есть задом наперёд. Развернуть их
    // ДО отсечения лишней строки разведчика — значит выбросить ближайшую к читателю и
    // подставить дальнюю: порция уедет на строку, и одна пропадёт совсем.
    await resetTables([notifications])
    await seed(0, COUNT) // 7 строк, порции по 3
    const p1 = await getNotificationsPage(userId, PER)
    const p2 = await getNotificationsPage(userId, PER, decodeCursor(p1.next))
    const p3 = await getNotificationsPage(userId, PER, decodeCursor(p2.next))
    const forward = [...p1.items, ...p2.items, ...p3.items].map((n) => n.id)
    expect(forward).toHaveLength(COUNT)

    // Тот же обход в обратную сторону обязан дать ту же последовательность.
    const b2 = await getNotificationsPage(userId, PER, decodeCursor(p3.prev), 'before')
    const b1 = await getNotificationsPage(userId, PER, decodeCursor(b2.prev), 'before')
    expect([...b1.items, ...b2.items, ...p3.items].map((n) => n.id)).toEqual(forward)
  })

  it('«назад» без курсора не открывает ленту с конца', async () => {
    // Порядок шага вверх — по возрастанию. Без условия он отдал бы САМЫЕ СТАРЫЕ строки,
    // то есть лента открывалась бы с хвоста; направление без курсора обязано игнорироваться.
    await resetTables([notifications])
    await seed(0, COUNT)
    const start = await getNotificationsPage(userId, PER)
    const bogus = await getNotificationsPage(userId, PER, null, 'before')
    expect(bogus.items.map((n) => n.id)).toEqual(start.items.map((n) => n.id))
  })

  it('KEYSET ЭТОГО НЕ ДАЁТ: та же вставка сверху не сдвигает выдачу', async () => {
    await resetTables([notifications])
    await seed(0, COUNT)
    const first = await getNotificationsPage(userId, PER)
    const firstIds = first.items.map((n) => n.id)
    expect(first.next).not.toBeNull()

    await seed(100, 2) // сверху прилетели два новых — ровно как в предыдущем тесте

    const second = await getNotificationsPage(userId, PER, decodeCursor(first.next))
    const secondIds = second.items.map((n) => n.id)
    // Ни одной строки с первой порции: курсор указывает на СТРОКУ, а не на смещение.
    expect(secondIds.filter((id) => firstIds.includes(id))).toHaveLength(0)
  })
})
