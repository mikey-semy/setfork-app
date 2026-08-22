import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * СТОРОЖ ПЕРЕИМЕНОВАНИЯ СМОТРИТ НА ВСЕ ЧЕТЫРЕ ПОЛЯ, А НЕ НА ДВА.
 *
 * Раздача мифологических имён читает состав, потом переименовывает — и записывает только
 * если строка та же, что прочитали. Сравнивались лишь английские имя и должность, поэтому
 * правка админа, менявшая ТОЛЬКО русское имя или должность, пролетала мимо: условие
 * совпадало, и свежие русские значения молча затирались (авто-ревью на #770, P1).
 *
 * Гонку в цикле не воспроизвести, поэтому сторож вынесен отдельной функцией: снимок
 * передаётся явно, и «строку успели поправить» выражается обычной проверкой.
 */
const { db, councilExperts } = await import('@/shared/db')
const { renameIfUnchanged } = await import('@/shared/ai/gnome-account')

// id у специалиста СВОЙ (это же ключ аватарки и значение who в истории беседы), поэтому
// задаётся явно, а не выдаётся базой.
let seq = 0
const seed = async () => {
  const [row] = await db
    .insert(councilExperts)
    .values({ id: `chef-${++seq}`, nameEn: 'Chef', nameRu: 'Повар', professionEn: '', professionRu: '', persona: 'проба', domains: ['test'] } as never)
    .returning()
  return row
}

const rowOf = async (id: string) => (await db.select().from(councilExperts).where(eq(councilExperts.id, id)))[0]

const NEXT = { nameEn: 'Brokkr', nameRu: 'Брокк', professionEn: 'Chef', professionRu: 'Повар' }

beforeEach(async () => {
  await resetTables([councilExperts])
})

describe('сторож переименования специалиста', () => {
  it('строка не менялась — переименование проходит', async () => {
    const r = await seed()

    expect(await renameIfUnchanged(r as never, NEXT)).toBe(true)
    expect((await rowOf(r.id)).nameEn).toBe('Brokkr')
  })

  it('админ поправил РУССКОЕ имя — переименование отказывается, правка цела', async () => {
    const r = await seed()
    await db.update(councilExperts).set({ nameRu: 'Шеф-повар' }).where(eq(councilExperts.id, r.id))

    expect(await renameIfUnchanged(r as never, NEXT)).toBe(false)
    const after = await rowOf(r.id)
    expect(after.nameRu).toBe('Шеф-повар') // свежая правка НЕ затёрта
    expect(after.nameEn).toBe('Chef')
  })

  it('админ поправил РУССКУЮ должность — то же самое', async () => {
    const r = await seed()
    await db.update(councilExperts).set({ professionRu: 'Кондитер' }).where(eq(councilExperts.id, r.id))

    expect(await renameIfUnchanged(r as never, NEXT)).toBe(false)
    expect((await rowOf(r.id)).professionRu).toBe('Кондитер')
  })

  it('админ поправил английское имя — отказ, как и раньше', async () => {
    const r = await seed()
    await db.update(councilExperts).set({ nameEn: 'Cook' }).where(eq(councilExperts.id, r.id))

    expect(await renameIfUnchanged(r as never, NEXT)).toBe(false)
    expect((await rowOf(r.id)).nameEn).toBe('Cook')
  })
})
