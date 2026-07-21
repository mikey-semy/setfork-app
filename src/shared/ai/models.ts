import 'server-only'
import { getAiProviderConfig, type AiProviderId } from '@/shared/settings/ai'

export interface ModelOption {
  id: string
  name: string
  /** Человеческое имя для UI (из URI/id, если провайдер не дал display_name). */
  label: string
  /** Семейство/владелец модели (Yandex, DeepSeek, OpenAI, Qwen, Anthropic…). */
  family: string
  /** false = провайдер не прислал pricing вовсе: цена НЕИЗВЕСТНА (не «бесплатно»). */
  priceKnown: boolean
  promptPrice: number // за 1M prompt-токенов, в валюте провайдера (currency)
  completionPrice: number // за 1M completion-токенов
}

/** Человеческое имя модели: gpt://<каталог>/yandexgpt-5.1/latest → «yandexgpt-5.1»,
 *  openai/gpt-4o-mini → «gpt-4o-mini»; версия ≠ latest — в скобках. Чистая, тестируется. */
export function prettyModelName(id: string): string {
  const uri = /^(?:gpt|emb|art):\/\/[^/]+\/([^/]+)(?:\/([^/@]+))?(?:@(.+))?$/.exec(id)
  if (uri) {
    const [, name, ver, tuned] = uri
    const verPart = ver && ver !== 'latest' ? ` (${ver})` : ''
    return `${name}${tuned ? `@${tuned}` : ''}${verPart}`
  }
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(slash + 1) : id
}

/** Семейство: owned_by провайдера, иначе вендор из префикса id (openai/…, gpt://…/yandexgpt…). */
export function modelFamily(id: string, ownedBy?: string): string {
  if (ownedBy && ownedBy !== 'gateway') return ownedBy
  const slash = id.indexOf('/')
  if (!id.includes('://') && slash > 0) {
    const vendor = id.slice(0, slash)
    return vendor.charAt(0).toUpperCase() + vendor.slice(1)
  }
  const n = prettyModelName(id)
  if (/^(yandexgpt|aliceai)/.test(n)) return 'Yandex'
  if (/^deepseek/.test(n)) return 'DeepSeek'
  if (/^qwen/.test(n)) return 'Qwen'
  if (/^gpt-oss/.test(n)) return 'OpenAI'
  return ''
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
  owned_by?: string
  pricing?: { prompt?: string; completion?: string }
}

function toOptions(raw: RawModel[] | undefined): ModelOption[] {
  return (raw ?? [])
    .map((m) => ({
      id: m.id,
      name: m.display_name || m.name || m.id,
      label: m.display_name || prettyModelName(m.id),
      family: modelFamily(m.id, m.owned_by),
      priceKnown: m.pricing != null,
      promptPrice: (Number(m.pricing?.prompt) || 0) * 1_000_000,
      completionPrice: (Number(m.pricing?.completion) || 0) * 1_000_000,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
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
    // и realtime-речь — в chat-селекте им не место; rc/deprecated-версии тоже
    // прячем (мусорят выбор, для них есть явный ввод id руками).
    chat: toOptions(chat).filter(
      (m) => !/^emb:\/\/|^art:\/\/|\/speech-/.test(m.id) && !/\/(rc|deprecated)$/.test(m.id),
    ),
    embedding: toOptions(embedding).filter((m) => EMBEDDING_1536.has(m.id)),
  }
}
