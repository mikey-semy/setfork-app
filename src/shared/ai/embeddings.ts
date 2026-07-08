import 'server-only'
import { getApiKey } from '@/shared/settings/ai'
import { recordUsage } from './usage'

/** Кто/зачем зовёт эмбеддинги — для учёта расхода в ai_usage (feature 'embed'). */
export interface EmbedMeta {
  userId?: string | null
  refType?: string
  refId?: string
}

// Эмбеддинги через OpenRouter (openai/text-embedding-3-small → 1536 dims,
// под колонку embeddings.embedding). Один OPENROUTER_API_KEY на чат и эмбеддинги.
// Любая ошибка → null, чтобы вызывающий мог пропустить индексацию.

const API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'
const DEFAULT_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small'

export const EMBEDDING_DIM = 1536

export async function isEmbeddingEnabled(): Promise<boolean> {
  return Boolean(await getApiKey())
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': 'SetFork',
  }
}

export async function embedTexts(texts: string[], model?: string, meta?: EmbedMeta): Promise<number[][] | null> {
  const key = await getApiKey()
  if (!key || texts.length === 0) return null
  const usedModel = model || DEFAULT_EMBEDDING_MODEL
  try {
    const res = await fetch(`${API_URL}/embeddings`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({ model: usedModel, input: texts }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`[embeddings] HTTP ${res.status} (model=${usedModel})`)
      return null
    }
    const data = (await res.json()) as {
      data?: { embedding: number[] }[]
      usage?: { prompt_tokens?: number; total_tokens?: number }
    }
    if (!Array.isArray(data.data)) return null
    // Эмбеддинги готовы — фиксируем их ДО учёта расхода, чтобы результат не зависел
    // от записи в ai_usage (recordUsage к тому же гасит свои ошибки и не бросает).
    const out = data.data.map((d) => d.embedding)
    // Учёт расхода: раньше эмбеддинги вообще не писались в ai_usage (слепая зона).
    // Стоимость эмбеддингов провайдер в теле не возвращает — пишем токены, cost 0.
    const tokens = data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? 0
    await recordUsage({
      userId: meta?.userId ?? null,
      feature: 'embed',
      model: usedModel,
      input: tokens,
      output: 0,
      total: tokens,
      cost: 0,
      refType: meta?.refType,
      refId: meta?.refId,
    })
    return out
  } catch (e) {
    console.warn('[embeddings] failed', e instanceof Error ? e.message : e)
    return null
  }
}

export async function embedOne(text: string, model?: string, meta?: EmbedMeta): Promise<number[] | null> {
  const result = await embedTexts([text], model, meta)
  return result ? result[0] : null
}
