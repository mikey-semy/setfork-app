import { describe, expect, it } from 'vitest'
import { breadcrumbList, creativeWork, itemList, profilePage, serializeJsonLd } from '@/shared/seo/jsonld'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * Структурные данные читает машина, и ошибку в них видно не глазами, а падением
 * богатого результата через недели. Поэтому проверяем то, что молча ломается:
 * абсолютность адресов, нумерацию позиций и экранирование содержимого.
 */
describe('JSON-LD', () => {
  it('адреса абсолютные — относительные schema.org молча игнорирует', () => {
    const data = breadcrumbList([{ name: 'miki', path: '/miki' }])
    const first = (data.itemListElement as { item: string }[])[0]

    expect(first.item).toBe(`${SITE_ORIGIN}/miki`)
  })

  it('позиции нумеруются с единицы и по порядку', () => {
    const data = itemList('list', [{ name: 'a' }, { name: 'b' }, { name: 'c' }])

    expect((data.itemListElement as { position: number }[]).map((e) => e.position)).toEqual([1, 2, 3])
    expect(data.numberOfItems).toBe(3)
  })

  it('название списка не может разорвать <script>', () => {
    const out = serializeJsonLd(itemList('</script><img src=x onerror=alert(1)>', []))

    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<')
    // Экранирование не должно ломать сам JSON — иначе разметка молча выпадет из разбора.
    expect(JSON.parse(out).name).toBe('</script><img src=x onerror=alert(1)>')
  })

  it('даты уезжают в ISO — по ним видно, что справочник живой', () => {
    const data = creativeWork({
      name: 'Deploy',
      path: '/miki/deploy',
      authorName: 'Mike',
      authorPath: '/miki',
      datePublished: new Date('2026-08-01T10:00:00Z'),
      dateModified: new Date('2026-08-28T10:00:00Z'),
      tags: ['devops', 'caddy'],
      version: 3,
    })

    expect(data.datePublished).toBe('2026-08-01T10:00:00.000Z')
    expect(data.dateModified).toBe('2026-08-28T10:00:00.000Z')
    expect(data.keywords).toBe('devops, caddy')
    expect(data.version).toBe(3)
  })

  it('пустые поля не превращаются в пустые ключи', () => {
    const data = creativeWork({ name: 'x', path: '/a/b', authorName: 'M', authorPath: '/m' })

    expect(data).not.toHaveProperty('description')
    expect(data).not.toHaveProperty('keywords')
    expect(data).not.toHaveProperty('dateModified')
  })

  it('профиль описывает человека, а не страницу', () => {
    const data = profilePage({ name: 'Mike', handle: 'miki', description: 'builds SetFork' })
    const person = data.mainEntity as Record<string, unknown>

    expect(person['@type']).toBe('Person')
    expect(person.alternateName).toBe('miki')
    expect(person.url).toBe(`${SITE_ORIGIN}/miki`)
  })
})
