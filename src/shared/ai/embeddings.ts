import 'server-only'
import { getAiProviderRaw, getOpenRouterApiKey } from '@/shared/settings/ai'
import { COLUMN_DIM, fitToColumn, getIndexSpace, type EmbedSpace } from './embed-space'
import { recordUsage } from './usage'

// Эмбеддинги идут по ПРОСТРАНСТВУ ИНДЕКСА (embed-space): и документы при
// индексации, и поисковые запросы — одним провайдером/моделью/мерностью, иначе
// близость — мусор. Пространство меняется только полным реиндексом (админка).
// - openrouter: openai/text-embedding-3-small (MRL, dimensions=768), одна модель
// - yandex: text-embeddings-v2-doc / -v2-query (768, dimensions в запросе),
//   ключ Яндекса из настроек ИИ — работает независимо от чат-провайдера
// Векторы приводятся к колонке halfvec(768) (fitToColumn) — см. embed-space.
// Любая ошибка → null, чтобы вызывающий мог пропустить индексацию.

/** Назначение вектора: 'doc' — индексация контента, 'query' — поисковый запрос. */
export type EmbedPurpose = 'doc' | 'query'

/** Кто/зачем зовёт эмбеддинги — для учёта расхода в ai_usage (feature 'embed'). */
export interface EmbedMeta {
  userId?: string | null
  refType?: string
  refId?: string
}

export const EMBEDDING_DIM = COLUMN_DIM // мерность колонки halfvec — единый источник в embed-space

export async function isEmbeddingEnabled(): Promise<boolean> {
  const space = await getIndexSpace()
  if (space.provider === 'yandex') {
    const raw = await getAiProviderRaw()
    return Boolean(raw.yandexKey && raw.yandexFolder)
  }
  return Boolean(await getOpenRouterApiKey())
}

async function endpointFor(space: EmbedSpace): Promise<{ url: string; headers: Record<string, string> } | null> {
  if (space.provider === 'yandex') {
    const raw = await getAiProviderRaw()
    if (!raw.yandexKey) return null
    const base = (process.env.YC_AI_URL || 'https://ai.api.cloud.yandex.net/v1').replace(/\/$/, '')
    return { url: `${base}/embeddings`, headers: { Authorization: `Bearer ${raw.yandexKey}`, 'Content-Type': 'application/json' } }
  }
  const key = await getOpenRouterApiKey()
  if (!key) return null
  const base = (process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  return {
    url: `${base}/embeddings`,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'SetFork',
    },
  }
}

// Кэш query-векторов (P2 анализа поиска, HQ research/2026-07-22): формулировки
// запросов повторяются (совет+гном+раскопка над одной темой), а вектор
// детерминирован → LRU в памяти. Только purpose='query': doc-тексты уникальны.
// Кэш-хит не пишет ai_usage — вызова провайдера не было.
const QUERY_CACHE_MAX = 500
const queryCache = new Map<string, number[]>()
function cacheGet(key: string): number[] | undefined {
  const hit = queryCache.get(key)
  if (hit) {
    queryCache.delete(key) // LRU: перекладываем в хвост
    queryCache.set(key, hit)
  }
  return hit
}
function cacheSet(key: string, vec: number[]): void {
  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string)
  queryCache.set(key, vec)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Один HTTP-вызов /embeddings: вектора (отсортированы по index) + токены.
 *  429 ретраится с бэкоффом (Retry-After провайдера или 1с/2с/4с) — реиндекс
 *  по одному тексту упирался в RPS-лимит Яндекса (прод 2026-07-22). */
async function requestEmbeddings(
  ep: { url: string; headers: Record<string, string> },
  model: string,
  input: string[],
  withDims: boolean,
  dims: number,
): Promise<{ vectors: number[][]; tokens: number } | null> {
  let res: Response | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(ep.url, {
      method: 'POST',
      headers: ep.headers,
      body: JSON.stringify({ model, input, ...(withDims ? { dimensions: dims } : {}) }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status !== 429 || attempt === 3) break
    const retryAfter = Number(res.headers.get('retry-after')) * 1000
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10_000) : 1000 * 2 ** attempt)
  }
  if (!res || !res.ok) {
    console.warn(`[embeddings] HTTP ${res?.status} (model=${model})`)
    return null
  }
  const data = (await res.json()) as {
    data?: { embedding: number[]; index?: number }[]
    usage?: { prompt_tokens?: number; total_tokens?: number }
  }
  if (!Array.isArray(data.data)) return null
  // Сортировка по index (фикс по ревью): спека OpenAI-совместимого ответа не гарантирует
  // порядок, а с чанками шагов путаница вектора списка и шага была бы тихой порчей индекса.
  const vectors = [...data.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => fitToColumn(d.embedding))
  return { vectors, tokens: data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? 0 }
}

export async function embedTexts(texts: string[], purpose: EmbedPurpose, meta?: EmbedMeta): Promise<number[][] | null> {
  if (texts.length === 0) return null
  const space = await getIndexSpace()
  const ep = await endpointFor(space)
  if (!ep) return null
  const model = purpose === 'query' ? space.queryModel : space.docModel
  const cacheKey = purpose === 'query' && texts.length === 1 ? `${model}\u0000${texts[0]}` : null
  if (cacheKey) {
    const hit = cacheGet(cacheKey)
    if (hit) return [hit]
  }
  // dimensions: Яндексу ОБЯЗАТЕЛЕН (дефолт v2 — 256), text-embedding-3-* умеет MRL;
  // прочим не шлём — не все OpenRouter-модели принимают параметр (усечёт fitToColumn).
  const withDims = space.provider === 'yandex' || /text-embedding-3/.test(model)
  const dims = Math.min(space.dim, EMBEDDING_DIM)
  try {
    let out: number[][]
    let tokens = 0
    if (space.provider === 'yandex' && texts.length > 1) {
      // Яндекс OpenAI-compat принимает РОВНО один текст на запрос («Array input
      // must contain exactly one string», прод 2026-07-22: реиндекс батчами по 32
      // ловил 400 и молча писал NULL-вектора). Шлём последовательно по одному —
      // и отдаём null ЦЕЛИКОМ, если упал хоть один: частичный батч = дыры в индексе.
      out = []
      for (const [i, t] of texts.entries()) {
        if (i > 0) await sleep(150) // щадим RPS-лимит Яндекса между запросами
        const one = await requestEmbeddings(ep, model, [t], withDims, dims)
        if (!one) return null
        out.push(one.vectors[0])
        tokens += one.tokens
      }
    } else {
      const r = await requestEmbeddings(ep, model, texts, withDims, dims)
      if (!r) return null
      out = r.vectors
      tokens = r.tokens
    }
    // Эмбеддинги готовы — фиксируем их ДО учёта расхода, чтобы результат не зависел
    // от записи в ai_usage (recordUsage к тому же гасит свои ошибки и не бросает).
    // Учёт расхода: стоимость эмбеддингов провайдер в теле не возвращает — токены, cost 0.
    await recordUsage({
      userId: meta?.userId ?? null,
      feature: 'embed',
      model,
      input: tokens,
      output: 0,
      total: tokens,
      cost: 0,
      refType: meta?.refType,
      refId: meta?.refId,
      provider: space.provider,
    })
    if (cacheKey && out[0]) cacheSet(cacheKey, out[0])
    return out
  } catch (e) {
    console.warn('[embeddings] failed', e instanceof Error ? e.message : e)
    return null
  }
}

export async function embedOne(text: string, purpose: EmbedPurpose, meta?: EmbedMeta): Promise<number[] | null> {
  const result = await embedTexts([text], purpose, meta)
  return result ? result[0] : null
}
