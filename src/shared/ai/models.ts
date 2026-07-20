import 'server-only'
import { getAiProviderConfig } from '@/shared/settings/ai'

export interface ModelOption {
  id: string
  name: string
  promptPrice: number // USD / 1M prompt tokens
  completionPrice: number // USD / 1M completion tokens
}

export interface ModelsResult {
  chat: ModelOption[]
  embedding: ModelOption[]
}

interface RawModel {
  id: string
  name?: string
  pricing?: { prompt?: string; completion?: string }
}

function toOptions(raw: RawModel[] | undefined): ModelOption[] {
  return (raw ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      promptPrice: (Number(m.pricing?.prompt) || 0) * 1_000_000,
      completionPrice: (Number(m.pricing?.completion) || 0) * 1_000_000,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

// Только 1536-мерные эмбеддинги совместимы с колонкой embeddings.embedding (pgvector 1536).
const EMBEDDING_1536 = new Set(['openai/text-embedding-3-small', 'openai/text-embedding-ada-002'])

async function fetchList(url: string, init?: RequestInit): Promise<RawModel[]> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return []
    const data = (await res.json()) as { data?: RawModel[] }
    return data.data ?? []
  } catch {
    return []
  }
}

/** Каталог моделей АКТИВНОГО провайдера (OpenAI-совместимый /models) — для
 *  селектов в админке. Список эмбеддингов — только у OpenRouter (фаза 2). */
export async function fetchModels(): Promise<ModelsResult> {
  const cfg = await getAiProviderConfig()
  if (!cfg) return { chat: [], embedding: [] }
  const init = { headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.headers ?? {}) } }
  const [chat, embedding] = await Promise.all([
    fetchList(`${cfg.baseUrl}/models`, init),
    cfg.provider === 'openrouter' ? fetchList(`${cfg.baseUrl}/embeddings/models`, init) : Promise.resolve([]),
  ])
  return {
    chat: toOptions(chat),
    embedding: toOptions(embedding).filter((m) => EMBEDDING_1536.has(m.id)),
  }
}
