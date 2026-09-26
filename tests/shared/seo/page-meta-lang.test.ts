import { describe, expect, it } from 'vitest'
import { pageMeta } from '@/shared/seo/page-meta'

/**
 * АДРЕС СТРАНИЦЫ ОДИН НА ВСЕ ЯЗЫКИ — И В КАНОНЕ, И В КАРТОЧКЕ СОЦСЕТЕЙ (ADR-0029).
 *
 * С 22 по 25.09 у страниц были адреса `/ru/…` и `/en/…`, канон указывал на них, а
 * `hreflang` связывал версии. Языка в адресе больше нет: канон — адрес без префикса, и
 * `hreflang` не нужен — он описывает разные адреса одной страницы.
 */
type Meta = { alternates: { canonical: string; languages?: unknown }; openGraph: { url?: string } }

describe('адрес страницы в метаданных', () => {
  const m = pageMeta({ title: 'Лента', path: '/explore' }) as unknown as Meta

  it('канон и карточка — один адрес без языкового префикса', () => {
    expect(m.alternates.canonical).toBe('/explore')
    expect(m.openGraph.url).toBe(m.alternates.canonical)
  })

  it('ссылок на языковые версии нет', () => {
    expect(m.alternates.languages).toBeUndefined()
  })
})
