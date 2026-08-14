import 'server-only'
import { getAiProviderRaw, getOpenRouterApiKey } from '@/shared/settings/ai'
import { COLUMN_DIM, fitToColumn, getIndexSpace, type EmbedProvider, type EmbedSpace } from './embed-space'
import { rememberCapability } from './embed-capability'
import { recordUsage } from './usage'
import { dataCollectionPolicy } from './provider'
import { appOrigin } from '@/shared/auth/app-origin'

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

/**
 * Куда и с чем стучаться за векторами.
 *
 * `body` — то, что кладётся в запрос ПОМИМО модели и текстов. У OpenRouter это политика
 * данных: эмбеддинги идут мимо фабрики chat-моделей (свой HTTP-вызов), поэтому запрет на
 * сбор, добавленный в provider.ts, их бы не коснулся — а на эмбеддинги уезжает СОДЕРЖИМОЕ
 * списков целиком, включая приватные (находка авто-ревью по #654).
 */
async function endpointFor(
  space: EmbedSpace,
): Promise<{ url: string; headers: Record<string, string>; body?: Record<string, unknown> } | null> {
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
      'HTTP-Referer': appOrigin(),
      'X-Title': 'SetFork',
    },
    body: { provider: { data_collection: dataCollectionPolicy() } },
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

export interface EmbedResponse {
  /** СЫРЫЕ вектора провайдера, отсортированы по index. К колонке приводит вызывающий:
   *  проба совместимости обязана видеть настоящую мерность, а не уже подогнанную. */
  vectors: number[][]
  tokens: number
  /** Цена вызова из ответа провайдера (OpenRouter отдаёт usage.cost), USD. 0 = не сказал. */
  costUsd: number
  /** Приняла ли модель параметр dimensions (false = пришлось звать без него). */
  dimsAccepted: boolean
}

/** Один HTTP-вызов /embeddings.
 *  429 ретраится с бэкоффом (Retry-After провайдера или 1с/2с/4с) — реиндекс
 *  по одному тексту упирался в RPS-лимит Яндекса (прод 2026-07-22).
 *  400 с dimensions — НЕ приговор: часть моделей параметра не знает. Такой отказ
 *  ровно один раз переспрашиваем без него и сообщаем об этом наверх, чтобы факт
 *  запомнился (embed-capability), а не проверялся регуляркой по имени вендора. */
async function requestEmbeddings(
  ep: { url: string; headers: Record<string, string>; body?: Record<string, unknown> },
  model: string,
  input: string[],
  dims: number | null,
): Promise<EmbedResponse | null> {
  let sendDims = dims
  let res: Response | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(ep.url, {
      method: 'POST',
      headers: ep.headers,
      body: JSON.stringify({ model, input, ...(sendDims ? { dimensions: sendDims } : {}), ...ep.body }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10_000) : 1000 * 2 ** attempt)
      continue
    }
    // Параметр не принят — пробуем без него (модель просто отдаст родную мерность).
    if ((res.status === 400 || res.status === 422) && sendDims) {
      sendDims = null
      continue
    }
    break
  }
  if (!res || !res.ok) {
    console.warn(`[embeddings] HTTP ${res?.status} (model=${model})`)
    return null
  }
  const data = (await res.json()) as {
    data?: { embedding: number[]; index?: number }[]
    usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number }
  }
  if (!Array.isArray(data.data)) return null
  // Сортировка по index (фикс по ревью): спека OpenAI-совместимого ответа не гарантирует
  // порядок, а с чанками шагов путаница вектора списка и шага была бы тихой порчей индекса.
  const vectors = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding)
  return {
    vectors,
    tokens: data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? 0,
    // Цену эмбеддингов провайдер ОТДАЁТ (проверено живьём на OpenRouter): писать ноль
    // значило скрывать расход от дневного капа и дашборда.
    costUsd: Number(data.usage?.cost) || 0,
    dimsAccepted: sendDims !== null || dims === null,
  }
}

/**
 * ПРОБА СОВМЕСТИМОСТИ: один короткий вызов без параметра dimensions — он отвечает на
 * вопрос «какая у этой модели РОДНАЯ мерность». Стоит доли цента и заменяет собой список
 * «известных» моделей в коде — тот устаревает молча и врал про 31 модель каталога.
 *
 * Раньше проба просила мерность колонки и запоминала ответ как свойство модели. Пока
 * колонка совпадала с моделью, разницы не было; с потолком шире модели такой факт означал
 * бы «модель умеет столько», хотя это лишь «столько попросили».
 *
 * Умеет ли модель dimensions, выясняется там, где это нужно, — когда родная мерность
 * ШИРЕ колонки и срез неизбежен (второй короткий вызов). Модели уже колонки резать
 * незачем: они ложатся с паддингом.
 */
export async function probeEmbedModel(
  provider: EmbedProvider,
  model: string,
): Promise<{ dim: number; dimsAccepted: boolean } | { error: string }> {
  const ep = await endpointFor({ provider, docModel: model, queryModel: model, dim: COLUMN_DIM })
  if (!ep) return { error: 'no-key' }
  try {
    // Без dimensions — так видно РОДНУЮ мерность. Провайдер, которому параметр обязателен,
    // на такой запрос ответит отказом: тогда спрашиваем с мерностью колонки, и родной
    // считается длина того, что он отдал (у 768-мерного Яндекса это те же 768).
    const r = (await requestEmbeddings(ep, model, ['probe'], null)) ?? (await requestEmbeddings(ep, model, ['probe'], COLUMN_DIM))
    const dim = r?.vectors[0]?.length
    if (!dim) return { error: 'no-vector' }
    if (dim <= COLUMN_DIM) return { dim, dimsAccepted: true }
    const cut = await requestEmbeddings(ep, model, ['probe'], COLUMN_DIM)
    return { dim, dimsAccepted: cut?.dimsAccepted ?? false }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' }
  }
}

export async function embedTexts(texts: string[], purpose: EmbedPurpose, meta?: EmbedMeta): Promise<number[][] | null> {
  if (texts.length === 0) return null
  const space = await getIndexSpace()
  const ep = await endpointFor(space)
  if (!ep) return null
  const model = purpose === 'query' ? space.queryModel : space.docModel
  // Ключ включает ПРОСТРАНСТВО, а не только модель: та же модель после реиндекса в другой
  // мерности (768 -> 1536) даёт вектор, несравнимый со свежими документами, а запись живёт
  // в кеше до вытеснения — поиск тихо ранжировал бы хуже. Чистить кеш в setIndexSpace мало:
  // процессов на проде несколько, чужую память так не достанешь (находка авто-ревью).
  const cacheKey =
    purpose === 'query' && texts.length === 1
      ? `${space.provider}\u0000${model}\u0000${space.dim}\u0000${texts[0]}`
      : null
  if (cacheKey) {
    const hit = cacheGet(cacheKey)
    if (hit) return [hit]
  }
  // Просим ровно мерность ПРОСТРАНСТВА (родная мерность модели, ограниченная колонкой):
  // модель шире колонки отдаст MRL-срез, остальным параметр ничего не меняет. Не знает
  // модель dimensions — узнаем из её же ответа (requestEmbeddings переспросит без него),
  // а не из списка «кто умеет» в коде.
  const dims = space.dim
  try {
    let raw: number[][]
    let tokens = 0
    let costUsd = 0
    let dimsAccepted = true
    if (space.provider === 'yandex' && texts.length > 1) {
      // Яндекс OpenAI-compat принимает РОВНО один текст на запрос («Array input
      // must contain exactly one string», прод 2026-07-22: реиндекс батчами по 32
      // ловил 400 и молча писал NULL-вектора). Шлём последовательно по одному —
      // и отдаём null ЦЕЛИКОМ, если упал хоть один: частичный батч = дыры в индексе.
      raw = []
      for (const [i, t] of texts.entries()) {
        if (i > 0) await sleep(150) // щадим RPS-лимит Яндекса между запросами
        const one = await requestEmbeddings(ep, model, [t], dims)
        if (!one) return null
        raw.push(one.vectors[0])
        tokens += one.tokens
        costUsd += one.costUsd
        dimsAccepted = dimsAccepted && one.dimsAccepted
      }
    } else {
      const r = await requestEmbeddings(ep, model, texts, dims)
      if (!r) return null
      raw = r.vectors
      tokens = r.tokens
      costUsd = r.costUsd
      dimsAccepted = r.dimsAccepted
    }
    // Что модель ответила — ФАКТ: запоминаем (без сети) и приводим к колонке. Но ТОЛЬКО
    // когда ответ родной: если dimensions приняли, длина вектора равна запрошенной, и
    // записывать её как свойство модели значило бы затереть измеренную родную мерность
    // тем, что мы сами же и попросили.
    if (raw[0]?.length && !dimsAccepted) void rememberCapability(space.provider, model, raw[0].length, false)
    const out = raw.map(fitToColumn)
    // Эмбеддинги готовы — фиксируем их ДО учёта расхода, чтобы результат не зависел
    // от записи в ai_usage (recordUsage к тому же гасит свои ошибки и не бросает).
    await recordUsage({
      userId: meta?.userId ?? null,
      feature: 'embed',
      model,
      input: tokens,
      output: 0,
      total: tokens,
      // Цена из ответа провайдера; нет её — прайс-слой оценит по токенам (recordUsage).
      cost: costUsd,
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
