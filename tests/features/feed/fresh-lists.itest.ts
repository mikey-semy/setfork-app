import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОЛКА ЗНАКОМСТВА ДЕЛАЕТ ТО, ЧТО ГОВОРИТ ПОДПИСЬ.
 *
 * ⚠️ Блок назывался «Рекомендации для вас» и рекомендациями не был: единственным следом
 * человека в запросе были «не мой» и «не отмечен мной», всё остальное — глобальный топ по
 * звёздам. У двух людей без звёзд выдача выходила ПОБАЙТОВО ОДИНАКОВОЙ — это и проверяем
 * первым тестом: не «персонализируй», а «не обещай персональное».
 *
 * Порядок теперь по свежести, и звёзд в нём нет вовсе. При одной звезде на весь корпус
 * (24 списка, аудит 02.09) `desc(starsCount)` ничего не сортировал — он лишь маскировал
 * выдачу под ранжирование.
 */
const { db, stars, templates, users } = await import('@/shared/db')
const { getFreshLists, getStarredIds } = await import('@/features/feed/queries')

const uid: Record<string, string> = {}
const at = (day: number) => new Date(Date.UTC(2026, 8, day, 12, 0, 0))

/** Список публичный и видимый: полка показывает только такие. */
const makeList = async (slug: string, owner: string, updatedDay: number, starsCount = 0) => {
  const [row] = await db
    .insert(templates)
    .values({
      ownerId: uid[owner],
      slug,
      title: { en: slug },
      visibility: 'public',
      status: 'published',
      moderation: 'active',
      starsCount,
      updatedAt: at(updatedDay),
    })
    .returning({ id: templates.id })
  return row.id
}

const slugs = async (viewer: string) => {
  const starred = await getStarredIds(uid[viewer])
  return (await getFreshLists(uid[viewer], starred, 4)).map((r) => r.slug)
}

beforeEach(async () => {
  await resetTables([stars, templates, users])
  const rows = await db
    .insert(users)
    .values([{ handle: 'fl-author' }, { handle: 'fl-anna' }, { handle: 'fl-boris' }])
    .returning({ id: users.id, handle: users.handle })
  for (const r of rows) uid[r.handle] = r.id
})

describe('порядок полки', () => {
  it('⚠️ сначала СВЕЖЕЕ, а не «звёздное»', async () => {
    // Старый порядок поднял бы «звёздный» наверх, хотя его не трогали неделю.
    await makeList('starry', 'fl-author', 1, 10)
    await makeList('fresh', 'fl-author', 9, 0)
    expect(await slugs('fl-anna')).toEqual(['fresh', 'starry'])
  })

  it('одинаковое время обновления не тасует полку между показами', async () => {
    // Доводчик порядка: без второго ключа соседние показы менялись бы местами.
    await makeList('one', 'fl-author', 5)
    await makeList('two', 'fl-author', 5)
    const first = await slugs('fl-anna')
    expect(await slugs('fl-anna')).toEqual(first)
  })
})

describe('чей это список', () => {
  it('свои списки на полку знакомства не попадают', async () => {
    await makeList('mine', 'fl-anna', 9)
    await makeList('theirs', 'fl-author', 8)
    expect(await slugs('fl-anna')).toEqual(['theirs'])
  })

  it('уже отмеченный звездой не показывается — знакомство состоялось', async () => {
    const known = await makeList('known', 'fl-author', 9)
    await makeList('unknown', 'fl-author', 8)
    await db.insert(stars).values({ templateId: known, userId: uid['fl-anna'] })
    expect(await slugs('fl-anna')).toEqual(['unknown'])
  })
})

describe('обещание подписи', () => {
  it('⚠️ двум РАЗНЫМ людям без звёзд полка совпадает — и это ЧЕСТНО, пока подпись не обещает личного', async () => {
    // Тот самый факт, из-за которого прежняя подпись была ложью. Тест держит его как
    // свойство: пока сигнала о человеке нет, выдача общая, и назвать её персональной
    // нельзя. Появится сигнал — тест обязан покраснеть, и это правильное место отказа.
    await makeList('a', 'fl-author', 9)
    await makeList('b', 'fl-author', 8)
    expect(await slugs('fl-anna')).toEqual(await slugs('fl-boris'))
  })

  it('скрытый список на полку не попадает', async () => {
    const hidden = await makeList('hidden', 'fl-author', 9)
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, hidden))
    await makeList('shown', 'fl-author', 8)
    expect(await slugs('fl-anna')).toEqual(['shown'])
  })
})
