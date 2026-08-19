import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMBEDDING_COLUMN_DIM } from '@/shared/db/schema'

/**
 * ПОРЯДОК СМЫСЛОВОЙ ВЫДАЧИ ДОЛЖЕН БЫТЬ СТРОГИМ — иначе страницы поиска врут.
 *
 * `semanticFeed` сортирует по близости к запросу. Равная близость здесь не краевой
 * случай, а норма: у повторной заливки того же текста эмбеддинг совпадает БИТ В БИТ,
 * и cosine-distance равен точно. Без доопределения до `id` база вправе вернуть такие
 * строки в любом порядке, и рвётся не только порядок:
 *
 *   1) `limit` отрезает выдачу по этому же порядку — значит на границе отсечки
 *      произволен САМ СОСТАВ: в хвост попадает то одна строка, то другая;
 *   2) склеенная выдача поиска (точные совпадения + смысловые) режется на страницы
 *      уже в памяти, поэтому её страницы наследуют произвол целиком.
 *
 * Проверяем на РЕАЛЬНОЙ БД: подделывается только вектор запроса (embedOne — внешний
 * вызов), сортировку и отсечку делает Postgres. Тест поставлен так, чтобы БЕЗ
 * доопределения он мог упасть: все строки равноудалены от запроса, то есть у базы нет
 * ни одной причины предпочесть какой-то порядок.
 */

const DIM = EMBEDDING_COLUMN_DIM
/** Вектор запроса и вектор всех списков — один и тот же: distance ровно 0 у каждого. */
const VEC = Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0))

vi.mock('@/shared/ai/embeddings', () => ({ embedOne: vi.fn(async () => VEC) }))

const { db, embeddings, templates, users } = await import('@/shared/db')
const { semanticFeed } = await import('@/features/library/queries/shared')
const { resetTables } = await import('../../helpers/reset-db')

const COUNT = 8
let ids: string[] = []

beforeAll(async () => {
  await resetTables([embeddings, templates, users])
  const [owner] = await db.insert(users).values({ handle: 'sem-owner' }).returning({ id: users.id })
  const rows = await db
    .insert(templates)
    .values(Array.from({ length: COUNT }, (_, i) => ({ ownerId: owner.id, slug: `sem-${i}`, title: { en: `sem ${i}` } })))
    .returning({ id: templates.id })
  ids = rows.map((r) => r.id)
  // Один и тот же вектор на все списки — равная близость у всех до последнего бита.
  await db.insert(embeddings).values(
    ids.map((id) => ({ kind: 'list', refId: id, content: 'одинаковый текст', embedding: VEC })),
  )
})

afterAll(async () => {
  await resetTables([embeddings, templates, users])
})

const idsOf = async (limit: number): Promise<string[]> => {
  const rows = await semanticFeed('запрос', undefined, limit, 0, undefined, [])
  expect(rows).not.toBeNull()
  return rows!.map((r) => r.id)
}

describe('semanticFeed: порядок доопределён до id', () => {
  it('на равной близости порядок — по id, а не какой попало', async () => {
    expect(await idsOf(COUNT)).toEqual([...ids].sort())
  })

  it('повторный запрос даёт ту же последовательность дословно', async () => {
    const [a, b, c] = [await idsOf(COUNT), await idsOf(COUNT), await idsOf(COUNT)]
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('состав отсечки по limit не плавает: те же строки, что и у полной выдачи', async () => {
    // Именно здесь произвол дороже всего: без доопределения `limit 3` из восьми
    // равноудалённых строк отдаёт ЛЮБЫЕ три, и от запроса к запросу они разные.
    const all = await idsOf(COUNT)
    expect(await idsOf(3)).toEqual(all.slice(0, 3))
    expect(await idsOf(3)).toEqual(all.slice(0, 3))
  })

  it('выдача растёт префиксом: каждая следующая начинается с предыдущей', async () => {
    // Обход по одной строке в чистом виде. У `semanticFeed` нет смещения — окно задаёт
    // только `limit`, поэтому устойчивость здесь и означает «выдача на N+1 строк
    // начинается ровно той же выдачей на N». Если бы порядок плавал, цепочка рвалась бы
    // на первом же шаге, а склеенная выдача поиска (она режется на страницы в памяти)
    // теряла и дублировала строки.
    //
    // Последовательно, а НЕ через Promise.all: восемь одновременных вызовов гоняют
    // восемь динамических импортов `@/shared/ai/embeddings`, и мок успевает подмениться
    // не для всех — один вызов достаётся настоящему embedOne, который без ключа
    // отдаёт null. Конкурентность тут ничего не проверяет, а гонку вносит.
    const chain: string[][] = []
    for (let n = 1; n <= COUNT; n++) chain.push(await idsOf(n))

    for (let n = 1; n < COUNT; n++) expect(chain[n].slice(0, n)).toEqual(chain[n - 1])
    const full = chain[COUNT - 1]
    expect(new Set(full).size).toBe(COUNT)
    expect(full).toEqual([...ids].sort())
  })
})
