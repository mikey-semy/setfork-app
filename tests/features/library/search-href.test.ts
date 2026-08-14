import { describe, expect, it } from 'vitest'
import { searchHref, SEARCH_BASE } from '@/features/library/search-href'

// Проверяем ДОГОВОР помощника, а не его копию: он отдаёт полный путь, и перепутать это с
// хвостом запроса легко — я и перепутал, собрав ссылки страниц как `/search?${qs(...)}`.
// Получалось `/search?/search?q=…`. Тест держит именно то свойство, на котором я споткнулся.

describe('адрес страницы поиска', () => {
  it('это полный путь, а не хвост запроса', () => {
    const href = searchHref({ q: 'docker' }, { page: '2' })

    expect(href).toBe('/search?q=docker&page=2')
    expect(href.startsWith(SEARCH_BASE)).toBe(true)
    expect(href.indexOf(SEARCH_BASE)).toBe(href.lastIndexOf(SEARCH_BASE)) // ровно один раз
  })

  it('действующие фильтры переживают переход по страницам', () => {
    // Иначе со второй страницы человек молча возвращается ко всей выдаче.
    const href = searchHref({ q: 'nginx', tag: 'devops', sort: 'newest' }, { page: '3' })

    expect(href).toContain('tag=devops')
    expect(href).toContain('sort=newest')
  })

  it('первая страница адресуется без параметра', () => {
    // У «сейчас» один канонический адрес, иначе ссылки на одно и то же расходятся.
    expect(searchHref({ q: 'docker' }, { page: undefined })).toBe('/search?q=docker')
  })

  it('пустой отбор даёт чистый путь', () => {
    expect(searchHref({}, {})).toBe(SEARCH_BASE)
    expect(searchHref({ q: undefined, tag: undefined }, {})).toBe(SEARCH_BASE)
  })
})
