import 'server-only'
import type { Lang } from '@/shared/i18n'
import { getAiProviderRaw } from '@/shared/settings/ai'

/**
 * Веб-гора (HQ: «интернет — наша гора»): реальный веб-поиск для гномов на
 * Яндекс-стороне. OpenRouter даёт веб через суффикс :online прямо в модели, а у
 * Яндекса своего веба нет — раньше веб-разведчик там ВЫДУМЫВАЛ прецеденты. Теперь
 * это настоящий вызов Yandex Search API v2; без ключа поиска (отдельный платный
 * сервис Yandex Cloud) веб-шаг просто пропускается — совет опирается на наш корпус.
 *
 * ⚠️ Требует ключ Search API (ai.yandex_search_api_key / YC_SEARCH_API_KEY) —
 * НЕ чат-ключ Яндекса; активируется и тарифицируется отдельно. Контракт v2:
 * POST /v2/web/search, Authorization: Api-Key, ответ FORMAT_XML в base64 (rawData).
 */

export interface WebHit {
  title: string
  url: string
  snippet: string
}

const SEARCH_URL = process.env.YC_SEARCH_API_URL || 'https://searchapi.api.cloud.yandex.net/v2/web/search'

/** Есть ли реальный веб-поиск (иначе веб-шаг пропускаем, а не галлюцинируем). */
export async function webSearchAvailable(): Promise<boolean> {
  const raw = await getAiProviderRaw()
  return Boolean(raw.yandexSearchKey && raw.yandexFolder)
}

const decodeXmlEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const stripTags = (s: string) => decodeXmlEntities(s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())

/**
 * Разбор Yandex XML (<doc><url><title><passages><passage>…). Без XML-библиотеки:
 * грунтинг терпит грубость, а неверная разметка → пустой список (безвредно).
 */
function parseYandexXml(xml: string, limit: number): WebHit[] {
  const hits: WebHit[] = []
  const docRe = /<doc[^>]*>([\s\S]*?)<\/doc>/g
  let m: RegExpExecArray | null
  while ((m = docRe.exec(xml)) && hits.length < limit) {
    const doc = m[1]
    const url = /<url>([\s\S]*?)<\/url>/.exec(doc)?.[1]
    if (!url) continue
    const title = /<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? ''
    const passages = [...doc.matchAll(/<passage>([\s\S]*?)<\/passage>/g)].map((p) => stripTags(p[1]))
    const headline = /<headline>([\s\S]*?)<\/headline>/.exec(doc)?.[1]
    const snippet = (passages.join(' ') || (headline ? stripTags(headline) : '')).slice(0, 300)
    hits.push({ title: stripTags(title), url: stripTags(url), snippet })
  }
  return hits
}

/**
 * Веб-поиск через Yandex Search API v2. Возвращает до `limit` результатов или
 * null, если поиск недоступен/упал (вызывающий тогда опирается на наш корпус).
 */
export async function webSearch(query: string, lang: Lang, limit = 5): Promise<WebHit[] | null> {
  const raw = await getAiProviderRaw()
  if (!raw.yandexSearchKey || !raw.yandexFolder) return null
  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${raw.yandexSearchKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { searchType: lang === 'ru' ? 'SEARCH_TYPE_RU' : 'SEARCH_TYPE_COM', queryText: query.slice(0, 400), page: '0' },
        folderId: raw.yandexFolder,
        responseFormat: 'FORMAT_XML',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.warn(`[web-search] HTTP ${res.status}`)
      return null
    }
    const data = (await res.json()) as { rawData?: string }
    if (!data.rawData) return null
    const xml = Buffer.from(data.rawData, 'base64').toString('utf8')
    return parseYandexXml(xml, limit)
  } catch (e) {
    console.warn('[web-search] failed', e instanceof Error ? e.message : e)
    return null
  }
}
