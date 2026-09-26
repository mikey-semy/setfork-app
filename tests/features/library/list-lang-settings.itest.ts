import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЯЗЫК ОРИГИНАЛА В НАСТРОЙКАХ СПИСКА (ADR-0030, шаг 2b) — полем «Основного». Подменены сессия, язык интерфейса и переходы Next; база, ядро и
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

const { db, listDrafts, templates, users } = await import('@/shared/db')
const { saveDraft, updateListMeta } = await import('@/features/library/actions/versions')

let me = ''
beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'lang-set' }).returning({ id: users.id })
  me = u.id
  h.session = { userId: me, handle: 'lang-set' }
})
beforeEach(async () => {
  h.ui = 'ru'
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

describe('смена языка и права', () => {
  it('⚠️ сменили язык — одноязычное название переезжает под новый ключ', async () => {
    const id = await seed('rekey', { ru: 'Гарбузовы суп' }, null)
    await updateListMeta(id, form({ title: 'Гарбузовы суп', sourceLang: 'be' }))
    expect(await row(id)).toMatchObject({ lang: 'be', title: { be: 'Гарбузовы суп' } })
  })

  it('с переводом — ключи не трогаем: какой из них оригинал, не ясно', async () => {
    const id = await seed('rekey-2', { ru: 'Суп', en: 'Soup' }, null)
    await updateListMeta(id, form({ title: 'Суп', sourceLang: 'be' }))
    expect((await row(id)).title).toEqual({ ru: 'Суп', en: 'Soup' })
  })

  it('⚠️ чужой человек язык и название не меняет', async () => {
    const id = await seed('mine', { ru: 'Суп' }, 'ru')
    const [other] = await db.insert(users).values({ handle: 'stranger' }).returning({ id: users.id })
    h.session = { userId: other.id, handle: 'stranger' }
    try {
      await updateListMeta(id, form({ title: 'Чужое', sourceLang: 'de' }))
    } finally {
      h.session = { userId: me, handle: 'lang-set' }
    }
    expect(await row(id)).toMatchObject({ lang: 'ru', title: { ru: 'Суп' } })
  })
})

describe('редактор списка — ключ правки', () => {
  it('⚠️ белорусский список, русский интерфейс: правка шага в черновике — под `be`, а не `ru`', async () => {
    const id = await seed('draft-be', { be: 'Гарбузовы суп' }, 'be')
    try {
      await saveDraft(id, form({ items: JSON.stringify([{ title: 'Нарэзаць гарбуз дробна' }]) }))
    } catch (e) {
      if ((e as Error).message !== 'REDIRECT') throw e
    }
    const [d] = await db.select({ items: listDrafts.items }).from(listDrafts).where(eq(listDrafts.templateId, id))
    expect(d?.items[0]?.title).toEqual({ be: 'Нарэзаць гарбуз дробна' })
  })
})
