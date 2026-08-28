import { inArray } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОИСК ПОЛЬЗОВАТЕЛЕЙ ОТДАЁТ ОДНО И ТО ЖЕ НА ОДИН И ТОТ ЖЕ ЗАПРОС.
 *
 * Маршрут берёт восемь совпадений по префиксу. Без `order by` это произвольная восьмёрка:
 * человек набирает `ma`, подходящих ников полсотни — он видит случайные восемь, и они
 * МЕНЯЮТСЯ между нажатиями для одного и того же префикса. Нужного человека можно не
 * увидеть вовсе, и выглядит это не ошибкой, а «его нет». Поиском пользуются выбор
 * исполнителя, поиск по квалификаторам и упоминания через `@`.
 *
 * ⚠️ Наивная проверка здесь НИЧЕГО НЕ ДОКАЗЫВАЕТ: на маленькой таблице Postgres и без
 * сортировки отдаёт строки в порядке вставки, поэтому тест зеленеет и со снятым
 * `order by`. Поэтому порядок ЛОМАЕТСЯ НАРОЧНО — обновлением строки: `UPDATE` переписывает
 * её на новое физическое место, в конец таблицы, и чтение без сортировки вернёт её
 * последней. Приём подсказан сессией ядра; то же свойство Postgres, которое в другом нашем
 * тесте служило способом ЗАДАТЬ порядок (и потому врало), здесь работает как провокация.
 */

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session }))
vi.mock('@/shared/rate-limit', () => ({
  rateLimit: async () => ({ ok: true }),
  tooMany: () => new Response('too many', { status: 429 }),
}))

const { db, users } = await import('@/shared/db')
const { GET } = await import('@/app/api/users/search/route')

/**
 * Девять ников при отсечении по восемь — чтобы проверялся СОСТАВ, а не только порядок.
 * Это существеннее: `limit` без сортировки меняет не расположение строк, а то, какие из
 * них вообще попадут в ответ. Формулировка признака решает исход поиска таких мест —
 * «непонятный порядок» заставляет отбросить случай, где порядок не важен, «непонятный
 * состав» не заставляет.
 *
 * Порядок ВСТАВКИ намеренно обратный ожидаемому, иначе тест сойдётся случайно.
 */
const HANDLES = [
  'msort-zzzzzzzzzzz9',
  'msort-zzzzzzzzzz8',
  'msort-zzzzzzzzz7',
  'msort-zzzzzzzz6',
  'msort-zzzzzzz5',
  'msort-zzzzzz4',
  'msort-zzzzz3',
  'msort-bb',
  'msort-a',
]

const search = async (q: string) => {
  const res = await GET(new Request(`http://localhost/api/users/search?q=${encodeURIComponent(q)}`))
  return ((await res.json()) as { handle: string }[]).map((r) => r.handle)
}

beforeAll(async () => {
  await resetTables([users])
})

beforeEach(async () => {
  await db.delete(users).where(inArray(users.handle, HANDLES))
  for (const handle of HANDLES) await db.insert(users).values({ handle, email: `${handle}@example.test` })
  // Провокация: первая вставленная строка уезжает в конец таблицы физически. Порядок
  // «как вставляли» после этого перестаёт совпадать с порядком «как лежит».
  await db.update(users).set({ avatarUrl: null }).where(inArray(users.handle, [HANDLES[0]]))
})

describe('поиск пользователей', () => {
  it('в ответ попадают ВОСЕМЬ САМЫХ КОРОТКИХ, а не произвольные восемь', async () => {
    const got = await search('msort-')
    expect(got).toHaveLength(8)
    // Самый длинный обязан быть отсечён — именно он проверяет, что сортировка идёт ДО
    // отсечения. Если бы `order by` применялся к уже урезанной выборке, порядок был бы
    // верным, а состав — случайным, и первая проверка этого бы не заметила.
    expect(got).not.toContain('msort-zzzzzzzzzzz9')
    expect(got).toEqual([...HANDLES].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 8))
  })

  it('одинаковый запрос — одинаковый ответ', async () => {
    const first = await search('msort-')
    await db.update(users).set({ avatarUrl: null }).where(inArray(users.handle, [HANDLES[2]]))
    expect(await search('msort-')).toEqual(first)
  })
})
