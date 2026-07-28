import 'server-only'
import { getAiProviderConfig, modelAllowed, parseModelAllowlist, type AiProviderId } from '@/shared/settings/ai'

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

// Чистые имена вынесены в model-names.ts (клиенту нужен prettyModelName в родословной,
// а этот модуль server-only). Реэкспорт — обратная совместимость импортов.
export { prettyModelName, modelFamily } from './model-names'
import { prettyModelName, modelFamily } from './model-names'

export interface ModelsResult {
  provider: AiProviderId
  /** false = у провайдера нет ключа: каталог недоступен, id вводится руками. */
  configured: boolean
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

const EMPTY: ModelsResult = { provider: 'openrouter', currency: 'USD', pricesKnown: true, configured: false, chat: [], embedding: [] }

/** Каталог моделей АКТИВНОГО провайдера (OpenAI-совместимый /models) — для
 *  селектов в админке. Список эмбеддингов — только у OpenRouter (фаза 2).
 *  Цены: OpenRouter — USD/токен из API, Selectel — RUB/токен из API; Яндекс в
 *  API цен не отдаёт — подставляем хардкод-прайс (yandex-pricing, ₽/1M). */
export async function fetchModels(): Promise<ModelsResult> {
  return fetchModelsForConfig(await getAiProviderConfig())
}

/**
 * Каталог УКАЗАННОГО провайдера — для админки: там провайдера выбирают до сохранения.
 * Без этого выбор в селекте ничего не менял в списке моделей (баг 2026-07-27).
 */
export async function fetchModelsFor(provider: AiProviderId): Promise<ModelsResult> {
  const { getProviderConfigFor } = await import('@/shared/settings/ai')
  const cfg = await getProviderConfigFor(provider)
  // Ключа нет — каталог пуст, но провайдера возвращаем ВЫБРАННОГО: интерфейс должен
  // сказать «у этого провайдера нет ключа», а не молча показать чужой список.
  if (!cfg) return { ...EMPTY, provider }
  return fetchModelsForConfig(cfg)
}

async function fetchModelsForConfig(cfg: Awaited<ReturnType<typeof getAiProviderConfig>>): Promise<ModelsResult> {
  if (!cfg) return EMPTY
  const init = { headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.headers ?? {}) } }
  const [chat, embedding] = await Promise.all([
    fetchList(`${cfg.baseUrl}/models`, init),
    cfg.provider === 'openrouter' ? fetchList(`${cfg.baseUrl}/embeddings/models`, init) : Promise.resolve([]),
  ])
  // У Яндекса в общем /models лежат и эмбеддинги (emb://), и картинки (art://),
  // и realtime-речь — в chat-селекте им не место; rc/deprecated-версии тоже
  // прячем (мусорят выбор, для них есть явный ввод id руками).
  const allowlist = parseModelAllowlist()
  let chatOpts = toOptions(chat).filter(
    (m) =>
      !/^emb:\/\/|^art:\/\/|\/speech-/.test(m.id) &&
      !/^(Embeddings|GigaEmbeddings)/.test(m.id) && // эмбеддинг-модели GigaChat — не чат
      !/\/(rc|deprecated)$/.test(m.id) &&
      modelAllowed(m.id, allowlist), // allowlist стенда (env AI_MODEL_ALLOWLIST)
  )
  if (cfg.provider === 'yandex') {
    const { yandexPriceRub } = await import('./yandex-pricing')
    chatOpts = chatOpts.map((m) => {
      const price = yandexPriceRub(m.id)
      // Прайс за 1000 токенов → приводим к ₽/1M, как у остальных провайдеров.
      return price
        ? { ...m, priceKnown: true, promptPrice: price[0] * 1000, completionPrice: price[1] * 1000 }
        : m
    })
  }
  if (cfg.provider === 'gigachat') {
    const { gigachatPriceRub1M } = await import('./pricing')
    chatOpts = chatOpts.map((m) => {
      const price = gigachatPriceRub1M(m.id) // ₽/1М, вход=выход единая
      return price != null ? { ...m, priceKnown: true, promptPrice: price, completionPrice: price } : m
    })
  }
  return {
    provider: cfg.provider,
    configured: true,
    currency: cfg.provider === 'openrouter' ? 'USD' : 'RUB',
    pricesKnown: true, // per-model приоритетнее: без прайса опция покажет «—»
    chat: chatOpts,
    embedding: toOptions(embedding).filter((m) => EMBEDDING_1536.has(m.id)),
  }
}
