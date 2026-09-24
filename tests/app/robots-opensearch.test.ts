import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GET as robots } from '@/app/robots.txt/route'
import { GET as opensearch } from '@/app/opensearch.xml/route'
import { webSite } from '@/shared/seo/jsonld'
import { siteSearchUrl } from '@/shared/seo/search-url'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * robots.txt с Content Signals и описание поиска OpenSearch (ревью соответствия 23.09).
 */
describe('robots.txt', () => {
  it('Content-Signal — внутри группы User-Agent, перед правилами', async () => {
    const lines = (await robots().text()).split('\n')
    const ua = lines.indexOf('User-Agent: *')
    const signal = lines.indexOf('Content-Signal: search=yes, ai-input=yes, ai-train=no')
    expect(ua).toBeGreaterThanOrEqual(0)
    expect(signal).toBe(ua + 1)
    expect(lines.indexOf('Allow: /')).toBeGreaterThan(signal)
  })

  it('прежние правила на месте: обход разрешён, служебное закрыто, карта сайта названа', async () => {
    const text = await robots().text()
    for (const line of ['Allow: /', 'Disallow: /api/', 'Disallow: /healthz', 'Disallow: /settings', 'Disallow: /runs', `Sitemap: ${SITE_ORIGIN}/sitemap.xml`]) {
      expect(text.split('\n'), line).toContain(line)
    }
    // Host отменён Яндексом в 2018 — его здесь нет намеренно.
    expect(text).not.toMatch(/^Host:/m)
  })

  it('отдаётся как текст', () => {
    expect(robots().headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })
})

describe('OpenSearch', () => {
  it('описание 1.1 с шаблоном поиска по сайту', async () => {
    const res = opensearch()
    expect(res.headers.get('content-type')).toBe('application/opensearchdescription+xml; charset=utf-8')
    const xml = await res.text()
    expect(xml).toContain('xmlns="http://a9.com/-/spec/opensearch/1.1/"')
    expect(xml).toContain('<ShortName>SetFork</ShortName>')
    expect(xml).toContain(`template="${siteSearchUrl('{searchTerms}')}"`)
  })

  it('шаблон тот же, что у SearchAction в JSON-LD: одно описание поиска на сайт', () => {
    const action = (webSite() as { potentialAction: { target: { urlTemplate: string } } }).potentialAction
    expect(action.target.urlTemplate).toBe(siteSearchUrl('{search_term_string}'))
    // Подстановки разные по стандартам, адрес — общий.
    expect(siteSearchUrl('X')).toBe(`${SITE_ORIGIN}/search?q=X`)
  })

  it('корневой макет объявляет описание ссылкой rel="search"', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8')
    expect(layout).toMatch(/<link rel="search" type="application\/opensearchdescription\+xml"[^>]*href="\/opensearch\.xml"/)
  })
})
