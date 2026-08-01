import 'server-only'
import { getAiProviderConfig, modelAllowed, parseModelAllowlist, type AiProviderId } from '@/shared/settings/ai'
import { envNumber } from '@/shared/env'

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
  /** Окно контекста, токенов. 0 = провайдер не сказал. */
  contextLength: number
  /** Умеет ли модель строгий JSON по схеме (structured outputs). Наша генерация списков
   *  просит именно его, и модель без поддержки отвечает прозой — это видно только тут. */
  structured: boolean
  /** Внешняя оценка «уровня» модели (artificial_analysis intelligence index из каталога
   *  провайдера). 0 = не опубликована. Это единственный сигнал КАЧЕСТВА, который каталог
   *  даёт объективно: без него «дешёвая» и «годная» неразличимы, и автоподбор вытаскивает
   *  ролеплейные файнтюны по цене. */
  intelligence: number
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
  /** Причина, по которой каталог не приехал (сеть, HTTP-код, нет ключа).
   *  Пусто = всё в порядке. Молчаливый пустой список читается как «фичу
   *  выпилили» — интерфейс обязан назвать причину, а не прятать её. */
  error?: string
}

interface RawModel {
  id: string
  name?: string
  display_name?: string
  owned_by?: string
  pricing?: { prompt?: string; completion?: string }
  /** OpenRouter отдаёт окно контекста, список принимаемых параметров и внешние бенчи. */
  context_length?: number
  supported_parameters?: string[]
  benchmarks?: { artificial_analysis?: { intelligence_index?: number } }
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
      contextLength: Number(m.context_length) || 0,
      // Поле есть только у OpenRouter; у прочих провайдеров молчание = «не знаем»,
      // и врать «умеет» нельзя — на этом основан выбор модели под строгий JSON.
      structured: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('structured_outputs'),
      intelligence: Number(m.benchmarks?.artificial_analysis?.intelligence_index) || 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Размерность колонки embeddings.embedding (pgvector). ЕДИНЫЙ источник — embed-space:
 *  здесь стояло 1536, хотя колонка давно halfvec(768), и подпись поля в админке говорила
 *  владельцу неправду про то, что он выбирает. */
export { COLUMN_DIM as EMBEDDING_DIM } from './embed-space'

// Списка «совместимых» эмбеддинг-моделей здесь нет и быть не должно: провайдеры мерность в
// /models не отдают, а любая табличка или регулярка по имени вендора устаревает молча (так из
// 31 модели каталога предлагались две). Совместимость — ИЗМЕРЯЕМЫЙ факт (embed-capability):
// каталог отдаёт всё, что есть у провайдера, а выбор объясняется измеренной мерностью.

interface ListResult {
  models: RawModel[]
  /** Причина отказа: сеть или HTTP-код. Раньше глоталась в catch — и любой сбой
   *  выглядел как «у провайдера нет моделей». */
  error?: string
}

/** Потолок ожидания каталога. Он теперь на горячем пути (пул совета, сверка модели), а
 *  недоступный провайдер — штатная ситуация RU-стенда: без таймаута зависший коннект держал
 *  бы генерацию столько, сколько ему вздумается. */
const CATALOG_TIMEOUT_MS = envNumber('SETFORK_MODEL_CATALOG_TIMEOUT_S', 10) * 1000

async function fetchList(url: string, init?: RequestInit): Promise<ListResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) })
    if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
    const data = (await res.json()) as { data?: RawModel[] }
    return { models: data.data ?? [] }
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : 'network error' }
  }
}

const EMPTY: ModelsResult = { provider: 'openrouter', currency: 'USD', pricesKnown: true, configured: false, chat: [], embedding: [] }

/**
 * КЕШ КАТАЛОГА. Раньше каждый вызов ходил в сеть, и каталог был «дорогой справкой для
 * админки». Теперь он нужен на горячем пути (пул совета и подмена снятой модели выводятся
 * ИЗ НЕГО, а не из списков в коде) — значит, обязан быть дешёвым.
 *
 * Отказ кешируется КОРОТКО, а успех — надолго: моргание сети не должно на десять минут
 * превращаться в «у провайдера нет моделей», но и долбить недоступный провайдер на каждую
 * генерацию нельзя (RU-стенд без egress-моста — штатная ситуация, а не исключение).
 * Ключ включает baseUrl: сменили стенд/провайдера — другой ключ. Смена API-ключа гасит кеш
 * явно (clearModelCatalogCache из сохранения настроек).
 */
const CATALOG_TTL_MS = envNumber('SETFORK_MODEL_CATALOG_TTL_S', 600) * 1000
const CATALOG_FAIL_TTL_MS = Math.min(envNumber('SETFORK_MODEL_CATALOG_FAIL_TTL_S', 60) * 1000, CATALOG_TTL_MS)
const catalogCache = new Map<string, { at: number; ttl: number; result: ModelsResult }>()

export function clearModelCatalogCache(): void {
  catalogCache.clear()
}

/** Каталог моделей АКТИВНОГО провайдера (OpenAI-совместимый /models) — для
 *  селектов в админке. Список эмбеддингов — только у OpenRouter (фаза 2).
 *  Цены: OpenRouter — USD/токен из API, Selectel — RUB/токен из API; Яндекс и GigaChat
 *  API цен не отдают — подставляем прайс-книгу стенда (price-book, ₽/1M). */
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
  if (!cfg) return { ...EMPTY, provider, error: 'no-key' }
  return fetchModelsForConfig(cfg)
}

async function fetchModelsForConfig(cfg: Awaited<ReturnType<typeof getAiProviderConfig>>): Promise<ModelsResult> {
  if (!cfg) return EMPTY
  const cacheKey = `${cfg.provider} ${cfg.baseUrl}`
  const hit = catalogCache.get(cacheKey)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.result
  const result = await loadCatalog(cfg)
  const ok = !result.error && result.chat.length > 0
  catalogCache.set(cacheKey, { at: Date.now(), ttl: ok ? CATALOG_TTL_MS : CATALOG_FAIL_TTL_MS, result })
  return result
}

async function loadCatalog(cfg: NonNullable<Awaited<ReturnType<typeof getAiProviderConfig>>>): Promise<ModelsResult> {
  const init = { headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.headers ?? {}) } }
  const [chatRes, embeddingRes] = await Promise.all([
    fetchList(`${cfg.baseUrl}/models`, init),
    cfg.provider === 'openrouter' ? fetchList(`${cfg.baseUrl}/embeddings/models`, init) : Promise.resolve({ models: [] } as ListResult),
  ])
  const { models: chat } = chatRes
  const { models: embedding } = embeddingRes
  // Отказ каталога пишем в лог: на проде «пустой список» иначе неотличим от «моделей нет»
  // (RU-IP не видит openrouter.ai напрямую — ходит через egress-мост, и его падение выглядит так же).
  if (chatRes.error) console.warn(`[ai/models] каталог ${cfg.provider} не загрузился: ${chatRes.error}`)
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
  // У Яндекса и GigaChat в /models цен нет вовсе — подставляем прайс-книгу стенда
  // (данные, не таблица в коде). Одно правило на обоих: раньше это были две разные
  // ветки с разными единицами (₽/1000 против ₽/1М) — расхождение единиц ждало своего часа.
  if (cfg.provider === 'yandex' || cfg.provider === 'gigachat') {
    const [{ getPriceBook, priceRub1M }] = await Promise.all([import('./price-book')])
    const book = await getPriceBook()
    chatOpts = chatOpts.map((m) => {
      const price = priceRub1M(book, cfg.provider as 'yandex' | 'gigachat', m.id)
      return price ? { ...m, priceKnown: true, promptPrice: price[0], completionPrice: price[1] } : m
    })
  }
  return {
    provider: cfg.provider,
    configured: true,
    currency: cfg.provider === 'openrouter' ? 'USD' : 'RUB',
    pricesKnown: true, // per-model приоритетнее: без прайса опция покажет «—»
    chat: chatOpts,
    embedding: toOptions(embedding),
    error: chatRes.error,
  }
}
