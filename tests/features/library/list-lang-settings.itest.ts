import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЯЗЫК ОРИГИНАЛА В НАСТРОЙКАХ (ADR-0030, шаг 2b): у списка — полем «Основного», у автора —
 * «языком моих списков». Подменены сессия, язык интерфейса и переходы Next; база, ядро и
 * действия — настоящие.
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string }, ui: 'ru' as 'ru' | 'en' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => h.ui }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))

const { db, templates, users } = await import('@/shared/db')
const { createTemplate, updateListMeta } = await import('@/features/library/actions/versions')
const { saveMyListLang } = await import('@/features/settings/list-lang-actions')

let me = ''
beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'lang-set' }).returning({ id: users.id })
  me = u.id
  h.session = { userId: me, handle: 'lang-set' }
})
beforeEach(async () => {
  h.ui = 'ru'
  await db.update(users).set({ listLang: null }).where(eq(users.id, me))
})

async function seed(slug: string, title: Record<string, string>, lang: string | null) {
  const [t] = await db.insert(templates).values({ ownerId: me, slug, title, lang, status: 'published', visibility: 'public' }).returning({ id: templates.id })
  return t.id
}
const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}
const row = async (id: string) => (await db.select({ lang: templates.lang, title: templates.title }).from(templates).where(eq(templates.id, id)))[0]

describe('настройки списка → язык оригинала', () => {
  it('сохраняется код ISO', async () => {
    const id = await seed('s1', { ru: 'Суп' }, null)
    await updateListMeta(id, form({ title: 'Суп', sourceLang: 'be' }))
    expect((await row(id)).lang).toBe('be')
  })

  it('пусто — «не задан»; не код ISO — прежнее значение цело', async () => {
    const id = await seed('s2', { ru: 'Суп' }, 'ru')
    await updateListMeta(id, form({ title: 'Суп', sourceLang: 'russian' }))
    expect((await row(id)).lang).toBe('ru')
    await updateListMeta(id, form({ title: 'Суп', sourceLang: '' }))
    expect((await row(id)).lang).toBeNull()
  })

  it('⚠️ название — под тем ключом, что показан: белорусский оригинал при русском интерфейсе не раздваивается', async () => {
    const id = await seed('s3', { be: 'Суп з гарбузом' }, 'be')
    await updateListMeta(id, form({ title: 'Суп з гарбузом і морквай', sourceLang: 'be' }))
    expect((await row(id)).title).toEqual({ be: 'Суп з гарбузом і морквай' })
  })
})

describe('язык моих списков', () => {
  it('не код ISO — отказ; код и «не задан» — сохраняются', async () => {
    expect(await saveMyListLang('russian')).toEqual({ ok: false })
    expect(await saveMyListLang('be')).toEqual({ ok: true })
    expect((await db.select({ l: users.listLang }).from(users).where(eq(users.id, me)))[0].l).toBe('be')
    expect(await saveMyListLang(null)).toEqual({ ok: true })
    expect((await db.select({ l: users.listLang }).from(users).where(eq(users.id, me)))[0].l).toBeNull()
  })

  it('⚠️ новый список из веба — текст под языком настройки, а не интерфейса; язык списка — тот же', async () => {
    await saveMyListLang('be')
    try {
      await createTemplate(null, form({ title: 'Гарбузовы суп', items: JSON.stringify([{ title: 'Нарэзаць гарбуз' }]) }))
    } catch (e) {
      if ((e as Error).message !== 'REDIRECT') throw e
    }
    const rows = await db.select({ lang: templates.lang, title: templates.title }).from(templates).where(eq(templates.ownerId, me))
    const made = rows.find((r) => Object.values(r.title).includes('Гарбузовы суп'))
    expect(made).toMatchObject({ lang: 'be', title: { be: 'Гарбузовы суп' } })
  })
})
