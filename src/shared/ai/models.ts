import 'server-only'
import { getAiProviderConfig, type AiProviderId } from '@/shared/settings/ai'

export interface ModelOption {
  id: string
  name: string
  promptPrice: number // за 1M prompt-токенов, в валюте провайдера (currency)
  completionPrice: number // за 1M completion-токенов
}

export interface ModelsResult {
  provider: AiProviderId
  /** Валюта цен каталога: OpenRouter — USD, Selectel — RUB. */
  currency: 'USD' | 'RUB'
  /** false = провайдер не отдаёт цены в /models (Яндекс) — в UI цен не показываем. */
  pricesKnown: boolean
  chat: ModelOption[]
  embedding: ModelOption[]
}

interface RawModel {
  id: string
  name?: string
  display_name?: string
  pricing?: { prompt?: string; completion?: string }
}

function toOptions(raw: RawModel[] | undefined): ModelOption[] {
  return (raw ?? [])
    .map((m) => ({
      id: m.id,
      name: m.display_name || m.name || m.id,
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

const EMPTY: ModelsResult = { provider: 'openrouter', currency: 'USD', pricesKnown: true, chat: [], embedding: [] }

/** Каталог моделей АКТИВНОГО провайдера (OpenAI-совместимый /models) — для
 *  селектов в админке. Список эмбеддингов — только у OpenRouter (фаза 2).
 *  Цены: OpenRouter — USD/токен, Selectel — RUB/токен; Яндекс цен не отдаёт. */
export async function fetchModels(): Promise<ModelsResult> {
  const cfg = await getAiProviderConfig()
  if (!cfg) return EMPTY
  const init = { headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.headers ?? {}) } }
  const [chat, embedding] = await Promise.all([
    fetchList(`${cfg.baseUrl}/models`, init),
    cfg.provider === 'openrouter' ? fetchList(`${cfg.baseUrl}/embeddings/models`, init) : Promise.resolve([]),
  ])
  return {
    provider: cfg.provider,
    currency: cfg.provider === 'selectel' ? 'RUB' : 'USD',
    pricesKnown: cfg.provider !== 'yandex',
    // У Яндекса в общем /models лежат и эмбеддинги (emb://), и картинки (art://),
    // и realtime-речь — в chat-селекте им не место.
    chat: toOptions(chat).filter((m) => !/^emb:\/\/|^art:\/\/|\/speech-/.test(m.id)),
    embedding: toOptions(embedding).filter((m) => EMBEDDING_1536.has(m.id)),
  }
}
