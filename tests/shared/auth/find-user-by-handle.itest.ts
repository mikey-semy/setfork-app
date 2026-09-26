import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЧЕЛОВЕК ПО НИКУ ИЗ ПОЛЯ ВВОДА — одно правило на соавтора, получателя списка,
 * исполнителя и рецензента. Раньше каждое место искало по-своему, и «@Mike» в одном
 * поле находился, в другом нет, а удалённый аккаунт можно было назначить исполнителем.
 */
const { db, userRedirects, users } = await import('@/shared/db')
const { findUserByHandle } = await import('@/shared/auth/handle')

const id: Record<string, string> = {}

beforeEach(async () => {
  await resetTables([userRedirects, users])
  const rows = await db
    .insert(users)
    .values([
      { handle: 'fu-mike' },
      // Колонка регистрозависима, и такие строки в базе бывали (см. handleBlock).
      { handle: 'FU-Legacy' },
      { handle: 'fu-gone', deleted: true },
    ])
    .returning({ id: users.id, handle: users.handle })
  for (const r of rows) id[r.handle] = r.id
  await db.insert(userRedirects).values({ handle: 'fu-old-mike', userId: id['fu-mike'] })
})

describe('findUserByHandle', () => {
  it('«@», пробелы и регистр ввода не мешают', async () => {
    expect((await findUserByHandle(' @FU-Mike '))?.id).toBe(id['fu-mike'])
  })

  it('ник с заглавными в базе находится строчным вводом', async () => {
    expect((await findUserByHandle('fu-legacy'))?.id).toBe(id['FU-Legacy'])
  })

  it('удалённый аккаунт не находится', async () => {
    expect(await findUserByHandle('fu-gone')).toBeNull()
  })

  it('прежний ник права не выдаёт — переадресация только для ссылок', async () => {
    expect(await findUserByHandle('fu-old-mike')).toBeNull()
  })

  it('пустой ввод — никто', async () => {
    expect(await findUserByHandle(' @ ')).toBeNull()
  })
})
