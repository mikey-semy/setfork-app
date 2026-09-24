import { SITE_ORIGIN } from '@/shared/site'
import { escapeHtml as esc } from '@/shared/lib/escape'
import { siteSearchUrl } from '@/shared/seo/search-url'

/**
 * OPENSEARCH 1.1 — описание поиска по сайту для браузера.
 *
 * С ним браузер предлагает искать по SetFork прямо из адресной строки (в Firefox —
 * «добавить поисковую систему», в Chrome — поиск по сайту через Tab). Страница объявляет
 * описание ссылкой `<link rel="search" type="application/opensearchdescription+xml">`
 * в корневом макете. Спецификация: github.com/dewitt/opensearch (1.1, draft 6).
 *
 * Хост — `SITE_ORIGIN`, как у карты сайта и robots: это описание публичного сайта для
 * внешнего клиента, а не адрес текущего запроса.
 */
export const dynamic = 'force-static'

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>SetFork</ShortName>
  <Description>Search runnable, versioned lists on SetFork</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/x-icon">${esc(`${SITE_ORIGIN}/favicon.ico`)}</Image>
  <Url type="text/html" method="get" template="${esc(siteSearchUrl('{searchTerms}'))}"/>
  <Url type="application/opensearchdescription+xml" rel="self" template="${esc(`${SITE_ORIGIN}/opensearch.xml`)}"/>
</OpenSearchDescription>
`
  return new Response(xml, { headers: { 'content-type': 'application/opensearchdescription+xml; charset=utf-8' } })
}
