import { describe, expect, it } from 'vitest'
import { pageMeta } from '@/shared/seo/page-meta'

/**
 * КАРТОЧКА СОЦСЕТЕЙ НАЗЫВАЕТ ТОТ ЖЕ АДРЕС, ЧТО КАНОН.
 *
 * С SEO-1 у страницы свой адрес на каждом языке. Канон его знал, а `og:url` собирался из
 * пути без префикса: карточка `/ru/explore` называла себя `/explore`. Соцсеть склеивала
 * её с версией без языка, и получатель ссылки попадал на язык своего браузера, а не на
 * тот, которым поделились (находка авто-ревью).
 */
type Meta = { alternates: { canonical: string }; openGraph: { url?: string } }

describe('адрес карточки', () => {
  it('с языком — префиксованный, ровно как канон', () => {
    const m = pageMeta({ title: 'Лента', path: '/explore', lang: 'ru' }) as unknown as Meta
    expect(m.openGraph.url).toBe('/ru/explore')
    expect(m.openGraph.url).toBe(m.alternates.canonical)
  })

  it('без языка — как был: путь без префикса', () => {
    // Обратная сторона: страницы, не передающие язык, не должны внезапно получить чужой.
    const m = pageMeta({ title: 'Лента', path: '/explore' }) as unknown as Meta
    expect(m.openGraph.url).toBe('/explore')
    expect(m.openGraph.url).toBe(m.alternates.canonical)
  })
})
