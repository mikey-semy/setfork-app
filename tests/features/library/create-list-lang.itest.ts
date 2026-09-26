import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * НОВЫЙ СПИСОК ИЗ ВЕБА: ЯЗЫК ИНТЕРФЕЙСА — ЗАПАСНОЙ, И ТОЛЬКО ЕСЛИ ТЕКСТ ЕМУ НЕ ПРОТИВОРЕЧИТ
 * (ADR-0030, ревью по линзам). Английский список автора с русским интерфейсом иначе навсегда
 * записался бы русским, и робот видел бы русскую страницу над английским текстом.
 * Подменены сессия, язык интерфейса и переходы Next; база, ядро и действие — настоящие.
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))

const { db, templates, users } = await import('@/shared/db')
const { createTemplate } = await import('@/features/library/actions/versions')

beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'web-lang' }).returning({ id: users.id })
  h.session = { userId: u.id, handle: 'web-lang' }
})

async function create(title: string, step: string) {
  const f = new FormData()
  f.set('title', title)
  f.set('items', JSON.stringify([{ title: step }]))
  try {
    await createTemplate(null, f)
  } catch (e) {
    if ((e as Error).message !== 'REDIRECT') throw e
  }
}

describe('язык нового списка из веба (интерфейс ru)', () => {
  it('русский текст — ru', async () => {
    const all = async () => db.select({ lang: templates.lang, title: templates.title }).from(templates)
    await create('Гороховый суп', 'Замочить горох на ночь')
    expect((await all()).find((r) => Object.values(r.title).includes('Гороховый суп'))?.lang).toBe('ru')
  })

  it('⚠️ уверенно английский текст — язык интерфейса не пишется', async () => {
    await create('Docker Compose setup', 'Install docker and write the compose file')
    const rows = await db.select({ lang: templates.lang, title: templates.title }).from(templates)
    expect(rows.find((r) => Object.values(r.title).includes('Docker Compose setup'))?.lang).toBeNull()
  })
})
