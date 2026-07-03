import 'server-only'
import { getApiKey } from '@/shared/settings/ai'

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

export async function embedTexts(texts: string[], model?: string): Promise<number[][] | null> {
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
    const data = (await res.json()) as { data?: { embedding: number[] }[] }
    if (!Array.isArray(data.data)) return null
    return data.data.map((d) => d.embedding)
  } catch (e) {
    console.warn('[embeddings] failed', e instanceof Error ? e.message : e)
    return null
  }
}

export async function embedOne(text: string, model?: string): Promise<number[] | null> {
  const result = await embedTexts([text], model)
  return result ? result[0] : null
}
