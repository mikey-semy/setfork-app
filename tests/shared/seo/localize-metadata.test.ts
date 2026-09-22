import { describe, expect, it } from 'vitest'
import type { Metadata } from 'next'
import { localizeMetadata } from '@/shared/seo/localize'

/**
 * КАНОН СТРАНИЦЫ — НА ЯЗЫКЕ АДРЕСА.
 *
 * Замер прода 23.09.2026: у `/ru/miki/knigi-pro-gnomov-fork` канон был
 * `/miki/knigi-pro-gnomov-fork`, а `hreflang` не было ни одного. Поисковику это
 * говорит «русская версия — дубль», и русские списки в индекс не попадают — ровно то,
 * ради чего языки разводили по адресам. Страниц, собиравших канон сами, было пять.
 */
type Out = { alternates: { canonical: string; languages: Record<string, string> }; openGraph?: { url?: string } }
const base: Metadata = {
  title: 'Книги про гномов',
  alternates: { canonical: '/miki/knigi' },
  openGraph: { type: 'article', url: '/miki/knigi', title: 'Книги про гномов' },
}

describe('метаданные на языке адреса', () => {
  it('с префиксом: канон и og:url — на своём языке', () => {
    const m = localizeMetadata(base, 'ru') as unknown as Out
    expect(m.alternates.canonical).toBe('/ru/miki/knigi')
    expect(m.openGraph?.url).toBe('/ru/miki/knigi')
  })

  it('hreflang есть всегда, взаимный и с x-default', () => {
    // Односторонняя ссылка поисковиком не засчитывается: с любой версии видны обе.
    for (const lang of ['ru', 'en', null] as const) {
      const m = localizeMetadata(base, lang) as unknown as Out
      expect(m.alternates.languages).toEqual({ en: '/en/miki/knigi', ru: '/ru/miki/knigi', 'x-default': '/miki/knigi' })
    }
  })

  it('без префикса канон остаётся без префикса', () => {
    // Обратная сторона: адрес без языка сам выбирает язык, и объявлять его чужим нельзя.
    const m = localizeMetadata(base, null) as unknown as Out
    expect(m.alternates.canonical).toBe('/miki/knigi')
    expect(m.openGraph?.url).toBe('/miki/knigi')
  })

  it('номер страницы и вкладка — часть адреса, а не языка', () => {
    const m = localizeMetadata({ alternates: { canonical: '/tags/rust?page=3' } }, 'ru') as unknown as Out
    expect(m.alternates.canonical).toBe('/ru/tags/rust?page=3')
    expect(m.alternates.languages.en).toBe('/en/tags/rust?page=3')
  })

  it('страницу без канона не трогает', () => {
    const m: Metadata = { title: 'x' }
    expect(localizeMetadata(m, 'ru')).toBe(m)
  })

  it('остальные поля сохраняются', () => {
    const m = localizeMetadata({ ...base, robots: { index: false, follow: false } }, 'ru')
    expect(m.title).toBe('Книги про гномов')
    expect(m.robots).toEqual({ index: false, follow: false })
  })
})
