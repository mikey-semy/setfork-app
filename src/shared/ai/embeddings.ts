import 'server-only'
import { getAiProviderRaw, getOpenRouterApiKey } from '@/shared/settings/ai'
import { getIndexSpace, padToColumn, type EmbedSpace } from './embed-space'
import { recordUsage } from './usage'

// Эмбеддинги идут по ПРОСТРАНСТВУ ИНДЕКСА (embed-space): и документы при
// индексации, и поисковые запросы — одним провайдером/моделью/мерностью, иначе
// близость — мусор. Пространство меняется только полным реиндексом (админка).
// - openrouter: openai/text-embedding-3-small, 1536, одна модель на doc и query
// - yandex: text-embeddings-v2-doc / -v2-query (768, dimensions в запросе),
//   ключ Яндекса из настроек ИИ — работает независимо от чат-провайдера
// Векторы паддятся нулями до колонки vector(1536) — косинус сохраняется точно.
// Любая ошибка → null, чтобы вызывающий мог пропустить индексацию.

/** Назначение вектора: 'doc' — индексация контента, 'query' — поисковый запрос. */
export type EmbedPurpose = 'doc' | 'query'

/** Кто/зачем зовёт эмбеддинги — для учёта расхода в ai_usage (feature 'embed'). */
export interface EmbedMeta {
  userId?: string | null
  refType?: string
  refId?: string
}

export const EMBEDDING_DIM = 1536 // мерность КОЛОНКИ (родная мерность — в embed-space)

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

export async function embedTexts(texts: string[], purpose: EmbedPurpose, meta?: EmbedMeta): Promise<number[][] | null> {
  if (texts.length === 0) return null
  const space = await getIndexSpace()
  const ep = await endpointFor(space)
  if (!ep) return null
  const model = purpose === 'query' ? space.queryModel : space.docModel
  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: ep.headers,
      // dimensions шлём только когда мерность НЕ колоночная: OpenRouter ретранслирует
      // параметр не всем провайдерам, а Яндексу он обязателен (дефолт v2 — 256).
      body: JSON.stringify({ model, input: texts, ...(space.dim !== EMBEDDING_DIM ? { dimensions: space.dim } : {}) }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`[embeddings] HTTP ${res.status} (model=${model})`)
      return null
    }
    const data = (await res.json()) as {
      data?: { embedding: number[] }[]
      usage?: { prompt_tokens?: number; total_tokens?: number }
    }
    if (!Array.isArray(data.data)) return null
    // Эмбеддинги готовы — фиксируем их ДО учёта расхода, чтобы результат не зависел
    // от записи в ai_usage (recordUsage к тому же гасит свои ошибки и не бросает).
    const out = data.data.map((d) => padToColumn(d.embedding))
    // Учёт расхода: стоимость эмбеддингов провайдер в теле не возвращает — токены, cost 0.
    const tokens = data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? 0
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
