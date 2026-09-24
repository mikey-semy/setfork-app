// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveRobots } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data'
import robots from '@/app/robots'
import { GET as opensearch } from '@/app/opensearch.xml/route'
import { webSite } from '@/shared/seo/jsonld'
import { siteSearchUrl } from '@/shared/seo/search-url'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * robots.txt с Content Signals и описание поиска OpenSearch (ревью соответствия 23.09).
 *
 * robots.txt проверяется ТЕКСТОМ, который получит обходчик: объект из `robots.ts` гонится
 * через тот же генератор Next, что и в проде (`resolveRobots`), — иначе тест проверял бы
 * наше описание, а не файл.
 */
const robotsTxt = () => resolveRobots(robots())

describe('robots.txt', () => {
  it('Content-Signal — в группе User-Agent: *', () => {
    const lines = robotsTxt().split('\n')
    const ua = lines.indexOf('User-Agent: *')
    const signal = lines.indexOf('Content-Signal: search=yes, ai-input=yes, ai-train=no')
    const groupEnd = lines.indexOf('', ua)
    expect(ua).toBeGreaterThanOrEqual(0)
    expect(signal).toBeGreaterThan(ua)
    expect(signal).toBeLessThan(groupEnd)
  })

  it('прежние правила на месте: обход разрешён, служебное закрыто, карта сайта названа', () => {
    const lines = robotsTxt().split('\n')
    for (const line of ['Allow: /', 'Disallow: /api/', 'Disallow: /healthz', 'Disallow: /settings', 'Disallow: /runs', `Sitemap: ${SITE_ORIGIN}/sitemap.xml`]) {
      expect(lines, line).toContain(line)
    }
    // Host отменён Яндексом в 2018 — его здесь нет намеренно.
    expect(robotsTxt()).not.toMatch(/^Host:/m)
  })
})

describe('OpenSearch', () => {
  const doc = async () => new DOMParser().parseFromString(await opensearch().text(), 'application/xml')
  const NS = 'http://a9.com/-/spec/opensearch/1.1/'

  it('корректный XML описания 1.1 с обязательными элементами', async () => {
    expect(opensearch().headers.get('content-type')).toBe('application/opensearchdescription+xml; charset=utf-8')
    const d = await doc()
    expect(d.querySelector('parsererror')).toBeNull()
    expect(d.documentElement.localName).toBe('OpenSearchDescription')
    expect(d.documentElement.namespaceURI).toBe(NS)
    expect(d.getElementsByTagNameNS(NS, 'ShortName')[0]?.textContent).toBe('SetFork')
    expect(d.getElementsByTagNameNS(NS, 'Description')[0]?.textContent).toBeTruthy()
    expect(d.getElementsByTagNameNS(NS, 'Image')[0]?.textContent).toBe(`${SITE_ORIGIN}/favicon.ico`)
  })

  it('поиск — HTML-выдача по шаблону сайта; есть ссылка на само описание', async () => {
    const urls = [...(await doc()).getElementsByTagNameNS(NS, 'Url')]
    const html = urls.find((u) => u.getAttribute('type') === 'text/html')
    expect(html?.getAttribute('template')).toBe(siteSearchUrl('{searchTerms}'))
    const self = urls.find((u) => u.getAttribute('rel') === 'self')
    expect(self?.getAttribute('template')).toBe(`${SITE_ORIGIN}/opensearch.xml`)
  })

  it('шаблон тот же, что у SearchAction в JSON-LD: одно описание поиска на сайт', () => {
    const action = (webSite() as { potentialAction: { target: { urlTemplate: string } } }).potentialAction
    expect(action.target.urlTemplate).toBe(siteSearchUrl('{search_term_string}'))
    expect(siteSearchUrl('X')).toBe(`${SITE_ORIGIN}/search?q=X`)
  })

  it('корневой макет объявляет описание ссылкой rel="search" (не закомментированной)', () => {
    // Чтение исходника — слабая проверка (не видит, что компонент не рендерится), но
    // рендер корневого макета в юнит-тесте тянет сессию, базу и шрифты. Закомментированную
    // ссылку и `false &&` она по крайней мере ловит.
    const layout = readFileSync('src/app/layout.tsx', 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const link = /\n\s*<link rel="search" type="application\/opensearchdescription\+xml"[^>]*href="\/opensearch\.xml"/.exec(layout)
    expect(link).not.toBeNull()
    expect(layout.slice(Math.max(0, (link?.index ?? 0) - 40), link?.index)).not.toMatch(/&&\s*$/)
  })
})
