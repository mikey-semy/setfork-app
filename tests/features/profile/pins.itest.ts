import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАКРЕПИТЬ МОЖНО ДО ШЕСТИ СВОИХ СПИСКОВ, КОТОРЫЕ ВИДЯТ ВСЕ — С ЛЮБОГО ВХОДА.
 *
 * Форма взята у GitHub (Edit pinned items). До 23.09.2026 правило жило частями:
 * окно на профиле предлагало приватные списки и черновики — такой занимал слот, а
 * посетитель его не видел, — а кнопка «Закрепить» в шапке списка не знала предела и
 * закрепляла седьмой, восьмой и дальше. Проверяем оба входа на настоящей базе.
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { db, templates, users } = await import('@/shared/db')
const { updatePins, setListPinned } = await import('@/features/library/actions/list-settings')
const { getPinnableLists } = await import('@/features/profile/queries')
const { LISTS_PER_PAGE } = await import('@/shared/lib/paging')

const id: Record<string, string> = {}
let owner = ''

const pinnedSlugs = async () =>
  (await db.select({ slug: templates.slug }).from(templates).where(eq(templates.pinned, true)))
    .map((r) => r.slug)
    .sort()

beforeEach(async () => {
  await resetTables([templates, users])
  const [o, other] = await db
    .insert(users)
    .values([{ handle: 'pin-owner' }, { handle: 'pin-other' }])
    .returning({ id: users.id })
  owner = o.id
  h.session = { userId: owner, handle: 'pin-owner' }
  const rows = await db
    .insert(templates)
    .values([
      ...Array.from({ length: 7 }, (_, i) => ({
        ownerId: owner,
        slug: `pub-${i + 1}`,
        title: { ru: `Публичный ${i + 1}` },
        status: 'published' as const,
        visibility: 'public' as const,
        starsCount: i,
      })),
      { ownerId: owner, slug: 'private', title: { ru: 'Приватный' }, status: 'published' as const, visibility: 'private' as const },
      { ownerId: owner, slug: 'draft', title: { ru: 'Черновик' }, status: 'draft' as const, visibility: 'public' as const },
      { ownerId: other.id, slug: 'foreign', title: { ru: 'Чужой' }, status: 'published' as const, visibility: 'public' as const },
    ])
    .returning({ id: templates.id, slug: templates.slug })
  for (const r of rows) id[r.slug] = r.id
})

describe('что предлагает окно', () => {
  it('только свои списки, которые видят все, — с названием и звёздами', async () => {
    const { items: lists, hasMore } = await getPinnableLists(owner)
    expect(hasMore).toBe(false)
    expect(lists.map((l) => l.slug).sort()).toEqual(['pub-1', 'pub-2', 'pub-3', 'pub-4', 'pub-5', 'pub-6', 'pub-7'])
    const third = lists.find((l) => l.slug === 'pub-3')
    expect(third?.title).toEqual({ ru: 'Публичный 3' })
    expect(third?.stars).toBe(2)
  })
})

describe('окно при сотнях списков', () => {
  // Раньше здесь был молчаливый предел в 100: списки за ним окно не показывало и не
  // говорило, что они есть. Теперь окно небольшое, но поиск идёт по всем.
  const many = async (n: number) => {
    await db.insert(templates).values(
      Array.from({ length: n }, (_, i) => ({
        ownerId: owner,
        slug: `bulk-${i}`,
        title: { ru: `Массовый ${i}` },
        status: 'published' as const,
        visibility: 'public' as const,
        updatedAt: new Date(Date.UTC(2020, 0, 1 + i)),
      })),
    )
    // Самый старый — за пределами окна; его и ищем по слову из названия.
    await db.update(templates).set({ title: { ru: 'Самый старый про Kubernetes' } }).where(eq(templates.slug, 'bulk-0'))
  }

  it('окно говорит, что есть ещё, — а не обрезает молча', async () => {
    await many(LISTS_PER_PAGE + 5)
    const { items, hasMore } = await getPinnableLists(owner)
    expect(items).toHaveLength(LISTS_PER_PAGE)
    expect(hasMore).toBe(true)
  })

  it('поиск находит список за пределами окна — по названию и по адресу', async () => {
    await many(LISTS_PER_PAGE + 5)
    const window = (await getPinnableLists(owner)).items.map((l) => l.slug)
    expect(window).not.toContain('bulk-0')
    expect((await getPinnableLists(owner, { q: 'kubernetes' })).items.map((l) => l.slug)).toEqual(['bulk-0'])
    expect((await getPinnableLists(owner, { q: 'bulk-0' })).items.map((l) => l.slug)).toContain('bulk-0')
  })

  it('поиск не показывает приватное и чужое', async () => {
    expect((await getPinnableLists(owner, { q: 'Приватный' })).items).toEqual([])
    expect((await getPinnableLists(owner, { q: 'Чужой' })).items).toEqual([])
  })

  it('закреплённые — первыми, даже самые старые', async () => {
    await many(LISTS_PER_PAGE + 5)
    await updatePins([id['pub-1']])
    await db.update(templates).set({ updatedAt: new Date(Date.UTC(2000, 0, 1)) }).where(eq(templates.id, id['pub-1']))
    expect((await getPinnableLists(owner)).items[0].slug).toBe('pub-1')
  })

  it('ищется название, а не служебные ключи переводов', async () => {
    // Поиск по тексту JSON находил «r» и «u» в ключе `ru` у каждого списка.
    expect((await getPinnableLists(owner, { q: 'ru' })).items).toEqual([])
    expect((await getPinnableLists(owner, { q: 'Публичный 3' })).items.map((l) => l.slug)).toEqual(['pub-3'])
  })

  it('знак % в поиске — буква, а не «что угодно»', async () => {
    expect((await getPinnableLists(owner, { q: '%' })).items).toEqual([])
  })
})

describe('сохранение из окна', () => {
  it('приватный, черновик и чужой не закрепляются, даже если их прислали', async () => {
    await updatePins([id.private, id.draft, id.foreign, id['pub-1']])
    expect(await pinnedSlugs()).toEqual(['pub-1'])
  })

  it('больше шести не закрепляется', async () => {
    await updatePins(['pub-1', 'pub-2', 'pub-3', 'pub-4', 'pub-5', 'pub-6', 'pub-7'].map((s) => id[s]))
    expect(await pinnedSlugs()).toHaveLength(6)
  })
})

describe('кнопка в шапке списка', () => {
  it('седьмой — отказ «уже шесть», а не молча седьмой на профиле', async () => {
    for (let i = 1; i <= 6; i++) expect(await setListPinned(id[`pub-${i}`], true)).toEqual({ ok: true })
    expect(await setListPinned(id['pub-7'], true)).toEqual({ error: 'full' })
    expect(await pinnedSlugs()).toHaveLength(6)
  })

  it('открепив один, можно закрепить другой', async () => {
    for (let i = 1; i <= 6; i++) await setListPinned(id[`pub-${i}`], true)
    expect(await setListPinned(id['pub-1'], false)).toEqual({ ok: true })
    expect(await setListPinned(id['pub-7'], true)).toEqual({ ok: true })
  })

  it('повторное «закрепить» уже закреплённого шестого — не отказ', async () => {
    // Обратная сторона предела: сам список в счёт не входит, иначе шестой нельзя было
    // бы переподтвердить.
    for (let i = 1; i <= 6; i++) await setListPinned(id[`pub-${i}`], true)
    expect(await setListPinned(id['pub-6'], true)).toEqual({ ok: true })
  })

  it('одновременные «закрепить» из разных вкладок не проходят за шесть', async () => {
    // Условие в самом UPDATE не спасает: строки разные, и каждая транзакция видит свой
    // снимок счёта. Держит замок строки владельца.
    for (let i = 1; i <= 4; i++) await setListPinned(id[`pub-${i}`], true)
    const res = await Promise.all(['pub-5', 'pub-6', 'pub-7'].map((s) => setListPinned(id[s], true)))
    expect(res.filter((r) => 'ok' in r)).toHaveLength(2)
    expect(await pinnedSlugs()).toHaveLength(6)
  })

  it('закреплённый, ставший приватным, слот не занимает — и седьмым не вернётся', async () => {
    // На профиле его нет: отказ «уже шесть», когда видно пять, был бы враньём. Но и
    // просто не считать его мало — вернись он в публичные, на профиле стало бы семь.
    for (let i = 1; i <= 6; i++) await setListPinned(id[`pub-${i}`], true)
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, id['pub-1']))
    expect(await setListPinned(id['pub-7'], true)).toEqual({ ok: true })
    await db.update(templates).set({ visibility: 'public' }).where(eq(templates.id, id['pub-1']))
    expect(await pinnedSlugs()).toHaveLength(6)
    expect(await pinnedSlugs()).not.toContain('pub-1')
  })

  it('приватный — отказ «не видят все»', async () => {
    expect(await setListPinned(id.private, true)).toEqual({ error: 'notPublic' })
    expect(await pinnedSlugs()).toEqual([])
  })
})
