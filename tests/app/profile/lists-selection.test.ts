import { describe, expect, it } from 'vitest'
import { NO_CATALOG, selectItems } from '@/app/[handle]/load'

// Правила выдачи вкладки «Списки». Повод для фильтра по полке: у владельца 523 списка, и
// лента без опоры бесполезна независимо от размера страницы. «Без каталога» — не украшение
// набора фильтров, а очередь разбора: ровно она отвечает, что ещё не разложено.

const item = (over: Partial<Row> = {}): Row => ({
  id: over.id ?? 'id',
  slug: over.slug ?? 'deploy-to-vps',
  title: over.title ?? { en: 'Deploy to VPS' },
  starsCount: over.starsCount ?? 0,
  visibility: over.visibility ?? 'public',
  origin: over.origin ?? 'authored',
  repositoryId: 'repositoryId' in over ? over.repositoryId : null,
})

type Row = {
  id: string
  slug: string
  title: Record<string, string | undefined>
  starsCount: number
  visibility: string
  origin: string | null
  repositoryId?: string | null
}

const pick = (items: Row[], over: Partial<Parameters<typeof selectItems>[0]> = {}) =>
  selectItems({ items, tab: 'lists', query: '', sort: 'recent', listType: 'all', ...over } as Parameters<typeof selectItems>[0])

describe('фильтр по полке', () => {
  const shelved = item({ id: 'in', slug: 'in-catalog', repositoryId: 'cat-1' })
  const otherShelf = item({ id: 'other', slug: 'other-catalog', repositoryId: 'cat-2' })
  const unfiled = item({ id: 'free', slug: 'no-catalog' })

  it('без фильтра видно всё', () => {
    expect(pick([shelved, otherShelf, unfiled])).toHaveLength(3)
  })

  it('полка показывает только своё', () => {
    expect(pick([shelved, otherShelf, unfiled], { catalog: 'devops', catalogId: 'cat-1' }).map((i) => i.id)).toEqual(['in'])
  })

  it('«без каталога» — это очередь разбора', () => {
    expect(pick([shelved, otherShelf, unfiled], { catalog: NO_CATALOG }).map((i) => i.id)).toEqual(['free'])
  })

  it('фильтр полки складывается с поиском и типом, а не спорит с ними', () => {
    const privateInShelf = item({ id: 'priv', slug: 'deploy-secret', visibility: 'private', repositoryId: 'cat-1' })
    const publicInShelf = item({ id: 'pub', slug: 'deploy-public', repositoryId: 'cat-1' })

    const res = pick([privateInShelf, publicInShelf, unfiled], { catalog: 'devops', catalogId: 'cat-1', listType: 'private', query: 'deploy' })

    expect(res.map((i) => i.id)).toEqual(['priv'])
  })

  it('на вкладке звёзд полки не применяются: там свои папки', () => {
    expect(pick([shelved, unfiled], { tab: 'starred', catalog: NO_CATALOG })).toHaveLength(2)
  })
})

describe('прежние правила не сломаны', () => {
  it('поиск идёт и по слагу, и по заголовку', () => {
    const a = item({ id: 'a', slug: 'bread-baking', title: { en: 'Bread' } })
    const b = item({ id: 'b', slug: 'deploy', title: { ru: 'Хлебопечка' } })

    expect(pick([a, b], { query: 'bread' }).map((i) => i.id)).toEqual(['a'])
    expect(pick([a, b], { query: 'хлебопечка' }).map((i) => i.id)).toEqual(['b'])
  })

  it('порядок по имени и по звёздам', () => {
    const a = item({ id: 'a', slug: 'b-list', starsCount: 1 })
    const b = item({ id: 'b', slug: 'a-list', starsCount: 9 })

    expect(pick([a, b], { sort: 'name' }).map((i) => i.id)).toEqual(['b', 'a'])
    expect(pick([a, b], { sort: 'stars' }).map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('форки отбираются по происхождению, а не по видимости', () => {
    const fork = item({ id: 'f', origin: 'forked' })
    const own = item({ id: 'o', origin: 'authored' })

    expect(pick([fork, own], { listType: 'forks' }).map((i) => i.id)).toEqual(['f'])
  })
})
