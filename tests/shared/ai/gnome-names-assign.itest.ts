import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Раздача собственных имён против РЕАЛЬНОЙ БД. Юнит покрывает правило «кому давать»
// (needsOwnName), а здесь проверяется то, что живёт только в записи: роль обязана
// уехать в колонку профессии, аккаунт — получить то же имя, второй прогон — ничего не
// менять. Ровно эти три вещи ломаются молча: имя разъезжается с профилем, должность
// подменяется именем, повторный прогон переименовывает уже названных.

const { councilExperts, db, users } = await import('@/shared/db')
const { assignMythicNames, unnamedGnomesCount } = await import('@/shared/ai/gnome-account')
const { isMythicName } = await import('@/shared/ai/gnome-names')

/** Строка ростера: как её кладёт сид (имя = роль) либо найм. */
const addExpert = async (e: { id: string; nameEn: string; nameRu: string; professionEn?: string; professionRu?: string; userId?: string | null }) => {
  await db.insert(councilExperts).values({
    id: e.id,
    nameEn: e.nameEn,
    nameRu: e.nameRu,
    professionEn: e.professionEn ?? '',
    professionRu: e.professionRu ?? '',
    userId: e.userId ?? null,
    persona: 'a test expert.',
    domains: ['test'],
  })
}

const expertRow = async (id: string) => (await db.select().from(councilExperts).where(eq(councilExperts.id, id)))[0]

beforeEach(async () => {
  await resetTables([councilExperts, users])
})
afterAll(async () => {
  await resetTables([councilExperts, users])
})

describe('раздача имён', () => {
  it('даёт имя, а роль переносит в профессию', async () => {
    await addExpert({ id: 'devops', nameEn: 'Devops', nameRu: 'Девопсер' })

    const res = await assignMythicNames()

    expect(res.renamed).toBe(1)
    const row = await expertRow('devops')
    expect(isMythicName(row.nameEn)).toBe(true)
    expect(row.professionEn).toBe('Devops')
    expect(row.professionRu).toBe('Девопсер')
  })

  it('связанный аккаунт получает то же имя и должность', async () => {
    const [u] = await db.insert(users).values({ handle: 'chef', name: 'Chef', profession: 'Chef', accountType: 'agent' }).returning({ id: users.id })
    await addExpert({ id: 'chef', nameEn: 'Chef', nameRu: 'Повар', userId: u.id })

    await assignMythicNames()

    const row = await expertRow('chef')
    const [account] = await db.select().from(users).where(eq(users.id, u.id))
    expect(account.name).toBe(row.nameEn)
    expect(account.profession).toBe('Chef')
  })

  it('второй прогон не переименовывает — заполненная профессия и есть отметка «имя выдано»', async () => {
    await addExpert({ id: 'coder', nameEn: 'Coder', nameRu: 'Кодер' })
    await assignMythicNames()
    const afterFirst = await expertRow('coder')

    const second = await assignMythicNames()

    expect(second.renamed).toBe(0)
    expect((await expertRow('coder')).nameEn).toBe(afterFirst.nameEn)
    expect(await unnamedGnomesCount()).toBe(0)
  })

  it('имя, заданное владельцем, не трогаем', async () => {
    await addExpert({ id: 'coach', nameEn: 'Gunnarr', nameRu: 'Гуннар', professionEn: 'Coach', professionRu: 'Тренер' })

    const res = await assignMythicNames()

    expect(res.renamed).toBe(0)
    expect((await expertRow('coach')).nameEn).toBe('Gunnarr')
  })

  it('правку админа, сделанную по ходу раздачи, не затираем', async () => {
    await addExpert({ id: 'devops', nameEn: 'Devops', nameRu: 'Девопсер' })
    // Владелец успел дать имя сам между чтением состава и записью: строка больше не та,
    // что мы прочитали, и раздача обязана её пропустить, а не перебить своим именем.
    const rows = await db.select().from(councilExperts)
    await db.update(councilExperts).set({ nameEn: 'Gunnarr', professionEn: 'Devops' }).where(eq(councilExperts.id, 'devops'))
    expect(rows[0].nameEn).toBe('Devops') // прочитанное состояние — устаревшее

    const res = await assignMythicNames()

    expect(res.renamed).toBe(0)
    expect((await expertRow('devops')).nameEn).toBe('Gunnarr')
  })

  it('канон не выдаётся дважды', async () => {
    await addExpert({ id: 'devops', nameEn: 'Devops', nameRu: 'Девопсер' })
    await addExpert({ id: 'smith', nameEn: 'Smith', nameRu: 'Кузнец' })

    await assignMythicNames()

    const [a, b] = [await expertRow('devops'), await expertRow('smith')]
    expect(a.nameEn).not.toBe(b.nameEn)
  })
})
