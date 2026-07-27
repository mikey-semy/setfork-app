import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

/** Ключ в app_settings, где хранится введённый в админке API-ключ OpenRouter. */
export const API_KEY_SETTING = 'ai.api_key'

export interface AiSettings {
  enabled: boolean
  chatModel: string
  fallbackModel: string
  embeddingModel: string
  temperature: number
  maxTokens: number
  /** Порог в USD: когда остаток на счёте OpenRouter ниже — переключаемся на fallbackModel. 0 = выкл. */
  cheapModeThreshold: number
  /** Веб-поиск (:online) в одиночной генерации. OFF по умолчанию: OpenRouter берёт флэт-фи ~$0.005
   *  за вызов — это было 60% всего расхода, включённое втихую на каждой генерации. */
  webSearch: boolean
  /** «Совет гномов»: мульти-модельная генерация (распорядитель→эксперты+новатор→критик→синтез). OFF по умолчанию. */
  councilEnabled: boolean
  /** Гетерогенная панель моделей для совета (id OpenRouter). Пусто → встроенный дефолт. */
  councilModels: string[]
  /** Максимум гномов-экспертов, созываемых распорядителем (лимит цены). */
  councilMaxGnomes: number
  /** Аудитория совета (гейт цены/раскатки): 'admin' — только админам (безопасно на проде), 'all' — всем. */
  councilAudience: 'admin' | 'all'
  /** Старейшина advanced-тира: искать прецеденты ещё и в интернете (:online). Дороже/медленнее. OFF по умолчанию. */
  councilWebSeek: boolean
  /** Диалог: при неоднозначном запросе совет сперва задаёт уточняющие вопросы (репортёр). OFF по умолчанию. */
  councilClarify: boolean
  /** Лимит советов на пользователя за ~месяц (не для админов); исчерпал → откат на одиночную. 0 = безлимит. */
  councilMaxPerMonth: number
  /**
   * Самогенерация: специалист сам пишет черновик списка по своей теме.
   * 'off' (дефолт) — выключено; 'manual' — только по кнопке из зала совета;
   * 'auto' — петля раз в сутки. Дефолт именно off: автономная трата денег не
   * должна включаться сама. Результат в любом режиме — ЧЕРНОВИК.
   */
  selfGenMode: 'off' | 'manual' | 'auto'
  /** Суточный кап черновиков самогенерации (сверх денежного потолка). 0 = без капа. */
  selfGenPerDay: number
  /**
   * Сколько списков за ОДИН проход петли. Темп компании = это число × число пробуждений
   * в сутки, и он ограничен сверху selfGenPerDay. Раньше было жёстко 1 при пробуждении
   * раз в сутки — то есть «сотни списков» набирались бы кварталами.
   */
  selfGenPerSweep: number
  /**
   * ПЛАНКА ГОТОВНОСТИ: при каких условиях черновик компании публикуется БЕЗ человека.
   * 'off' (дефолт) — не проверяем и не публикуем; 'shadow' — считаем решение и пишем в
   * журнал, но не публикуем (наблюдение перед включением); 'on' — публикуем прошедшие.
   * Человек утверждает планку, а не каждый список — иначе автономности нет.
   */
  readinessMode: 'off' | 'shadow' | 'on'
  /** Минимум шагов, ниже которого список не готов (жёсткий пол). */
  readinessMinSteps: number
  /** Минимальный класс полноты для публикации без человека: start | solid | full. */
  readinessMinGrade: 'start' | 'solid' | 'full'
  /** «Помощь на шаге»: AI-подсказка застрявшему в прогоне. OFF по умолчанию. */
  assistEnabled: boolean
  /** Аудитория помощи (гейт цены/раскатки): 'admin' — только админам, 'all' — всем. */
  assistAudience: 'admin' | 'all'
  /** Тариф Free: лимит генераций на пользователя за календарный месяц. 0 = безлимит (монетизация НЕ
   *  активирована). Ставится, когда Pro можно купить — иначе free-юзеров блокировать некуда. Pro/админ — без лимита. */
  freeMonthlyGens: number
}

const KEYS = [
  'ai.enabled',
  'ai.chat_model',
  'ai.fallback_model',
  'ai.embedding_model',
  'ai.temperature',
  'ai.max_tokens',
  'ai.cheap_mode_threshold',
  'ai.web_search',
  'ai.council_enabled',
  'ai.council_models',
  'ai.council_max_gnomes',
  'ai.council_audience',
  'ai.council_web_seek',
  'ai.council_clarify',
  'ai.council_max_per_month',
  'ai.readiness_mode',
  'ai.readiness_min_steps',
  'ai.readiness_min_grade',
  'ai.assist_enabled',
  'ai.assist_audience',
  // Ключи самогенерации ОБЯЗАНЫ быть здесь: KEYS — это то, что реально читается из БД.
  // Без них настройка из админки не применялась вовсе и режим всегда падал в 'off'
  // (латентный баг PR #488). Смоук этого не поймал, потому что 'manual' и 'off' дают
  // одинаковое поведение петли — тест проходил по неверной причине.
  'ai.selfgen_mode',
  'ai.selfgen_per_day',
  'ai.selfgen_per_sweep',
  'ai.free_monthly_gens',
] as const

// ── Провайдер ИИ (этап B: пользовательский текст — на RU-провайдера) ─────────
// Все три говорят по OpenAI-совместимому протоколу, поэтому клиент один
// (см. shared/ai/provider). Выбор: app_settings 'ai.provider' → env AI_PROVIDER
// → openrouter. Эмбеддинги пока ВСЕГДА OpenRouter (фаза 2: смена размерности
// вектора + реиндекс), поэтому его ключ читается и отдельно.
export type AiProviderId = 'openrouter' | 'selectel' | 'yandex' | 'gigachat'

export interface AiProviderConfig {
  provider: AiProviderId
  /** Корень OpenAI-совместимого API, без хвостового слэша (…/v1). */
  baseUrl: string
  apiKey: string
  /** Доп. заголовки (Яндекс: x-folder-id + запрет логирования). */
  headers?: Record<string, string>
}

export const PROVIDER_SETTING = 'ai.provider'
export const SELECTEL_KEY_SETTING = 'ai.selectel_api_key'
export const YANDEX_KEY_SETTING = 'ai.yandex_api_key'
export const YANDEX_FOLDER_SETTING = 'ai.yandex_folder_id'
export const GIGACHAT_KEY_SETTING = 'ai.gigachat_auth_key'
// Веб-гора (Yandex Search API v2): ОТДЕЛЬНЫЙ ключ Search API (не чат-ключ Яндекса) —
// сервис активируется и тарифицируется отдельно в Yandex Cloud. Пусто → веб-шаг
// пропускается (совет опирается на наш корпус), а НЕ выдумывает прецеденты.
export const YANDEX_SEARCH_KEY_SETTING = 'ai.yandex_search_api_key'

export const AI_PROVIDERS: readonly AiProviderId[] = ['openrouter', 'selectel', 'yandex', 'gigachat'] as const

/** Чистый резолв провайдера из настроек БД + env (юнит-тестируется без БД). */
export function resolveAiProvider(
  m: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
): AiProviderConfig | null {
  const provider = (m[PROVIDER_SETTING]?.trim() || env.AI_PROVIDER || 'openrouter') as AiProviderId
  if (provider === 'selectel') {
    const baseUrl = (env.SELECTEL_AI_URL || 'https://api.selectel.ru/aig/v1').trim().replace(/\/$/, '')
    const apiKey = (m[SELECTEL_KEY_SETTING]?.trim() || env.SELECTEL_AI_KEY || '').trim()
    return baseUrl && apiKey ? { provider, baseUrl, apiKey } : null
  }
  if (provider === 'gigachat') {
    // apiKey тут — Basic-ключ авторизации (ClientID:Secret, base64); короткоживущий
    // Bearer добывает getAiChatClient через gigachat-token. TLS: НУЦ-серт, см. certs/.
    const authKey = (m[GIGACHAT_KEY_SETTING]?.trim() || env.GIGACHAT_AUTH_KEY || '').trim()
    if (!authKey) return null
    return {
      provider,
      baseUrl: (env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1').trim().replace(/\/$/, ''),
      apiKey: authKey,
    }
  }
  if (provider === 'yandex') {
    const folder = (m[YANDEX_FOLDER_SETTING]?.trim() || env.YC_AI_FOLDER_ID || '').trim()
    const apiKey = (m[YANDEX_KEY_SETTING]?.trim() || env.YC_AI_API_KEY || '').trim()
    if (!folder || !apiKey) return null
    return {
      provider,
      // Новый хост AI Studio; старый llm.api.cloud.yandex.net тоже жив (оба проверены).
      baseUrl: (env.YC_AI_URL || 'https://ai.api.cloud.yandex.net/v1').trim().replace(/\/$/, ''),
      apiKey,
      // x-data-logging-enabled:false — запрет использования запросов Яндексом.
      headers: { 'x-folder-id': folder, 'x-data-logging-enabled': 'false' },
    }
  }
  const apiKey = (m[API_KEY_SETTING]?.trim() || env.OPENROUTER_API_KEY || '').trim()
  return apiKey
    ? { provider: 'openrouter', baseUrl: (env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''), apiKey }
    : null
}

/** Сырые провайдер-настройки для админки (БД → env). Ключи маскирует вызывающий. */
export async function getAiProviderRaw(): Promise<{
  provider: AiProviderId
  openrouterKey: string
  selectelKey: string
  yandexKey: string
  yandexFolder: string
  gigachatKey: string
  yandexSearchKey: string
}> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [PROVIDER_SETTING, API_KEY_SETTING, SELECTEL_KEY_SETTING, YANDEX_KEY_SETTING, YANDEX_FOLDER_SETTING, GIGACHAT_KEY_SETTING, YANDEX_SEARCH_KEY_SETTING]))
  const m = Object.fromEntries(rows.map((r) => [r.key, (r.value ?? '').trim()]))
  const raw = m[PROVIDER_SETTING] || process.env.AI_PROVIDER || 'openrouter'
  return {
    provider: (AI_PROVIDERS as readonly string[]).includes(raw) ? (raw as AiProviderId) : 'openrouter',
    openrouterKey: m[API_KEY_SETTING] || process.env.OPENROUTER_API_KEY?.trim() || '',
    selectelKey: m[SELECTEL_KEY_SETTING] || process.env.SELECTEL_AI_KEY?.trim() || '',
    yandexKey: m[YANDEX_KEY_SETTING] || process.env.YC_AI_API_KEY?.trim() || '',
    yandexFolder: m[YANDEX_FOLDER_SETTING] || process.env.YC_AI_FOLDER_ID?.trim() || '',
    gigachatKey: m[GIGACHAT_KEY_SETTING] || process.env.GIGACHAT_AUTH_KEY?.trim() || '',
    yandexSearchKey: m[YANDEX_SEARCH_KEY_SETTING] || process.env.YC_SEARCH_API_KEY?.trim() || '',
  }
}

/** Активный провайдер чата (null = ИИ не сконфигурирован). */
export async function getAiProviderConfig(): Promise<AiProviderConfig | null> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [PROVIDER_SETTING, API_KEY_SETTING, SELECTEL_KEY_SETTING, YANDEX_KEY_SETTING, YANDEX_FOLDER_SETTING, GIGACHAT_KEY_SETTING]))
  return resolveAiProvider(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])))
}

// ── Пер-провайдерные настройки моделей ───────────────────────────────
// Модели/пороги у каждого провайдера СВОИ (ai.<provider>.chat_model и т.д.):
// переключение провайдера ничего не затирает и не теряет. Легаси-ключи
// (ai.chat_model, …) читаются ТОЛЬКО как фолбэк openrouter-неймспейса — они
// писались в эпоху, когда провайдер был один.
export interface ModelSettings {
  chatModel: string
  fallbackModel: string
  councilModels: string[]
  /** OpenRouter: минимальный остаток баланса, $. Яндекс: дневной расход, ₽. */
  cheapModeThreshold: number
}

export const NS_MODEL_KEYS = ['chat_model', 'fallback_model', 'council_models', 'cheap_mode_threshold'] as const
export const nsKey = (provider: string, k: string) => `ai.${provider}.${k}`

/** Опциональный allowlist моделей стенда (env AI_MODEL_ALLOWLIST, CSV префиксов
 *  id). Пусто = всё разрешено. Пример строгого RU: `gpt://,emb://`. */
export function parseModelAllowlist(env: Record<string, string | undefined> = process.env): string[] {
  return (env.AI_MODEL_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean)
}

export function modelAllowed(id: string, allowlist: string[]): boolean {
  return allowlist.length === 0 || allowlist.some((p) => id.startsWith(p))
}

export function defaultChatModelFor(
  provider: AiProviderId,
  folder: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (provider === 'selectel') return env.SELECTEL_CHAT_MODEL || 'openai/gpt-4o-mini'
  if (provider === 'gigachat') return env.GIGACHAT_CHAT_MODEL || 'GigaChat-2'
  if (provider === 'yandex') return env.YC_CHAT_MODEL || `gpt://${folder}/yandexgpt-5.1/latest`
  return env.OPENROUTER_CHAT_MODEL || 'openai/gpt-4o-mini'
}

/** Чистый резолв модельных настроек активного провайдера (юнит-тестируется). */
export function resolveModelSettings(
  m: Record<string, string | undefined>,
  provider: AiProviderId,
  env: Record<string, string | undefined> = process.env,
): ModelSettings {
  const ns = (k: string) => m[nsKey(provider, k)]?.trim() || ''
  // Легаси-фолбэк только у openrouter: старые глобальные ключи писались для него.
  const legacy = (k: string) => (provider === 'openrouter' ? m[`ai.${k}`]?.trim() || '' : '')
  const folder = m[YANDEX_FOLDER_SETTING]?.trim() || env.YC_AI_FOLDER_ID || ''
  const allowlist = parseModelAllowlist(env)
  const csv = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean)

  const chatRaw = ns('chat_model') || legacy('chat_model')
  const chatDefault = defaultChatModelFor(provider, folder, env)
  const fallbackRaw = ns('fallback_model') || legacy('fallback_model')
  const councilRaw = ns('council_models') || legacy('council_models') || (provider === 'openrouter' ? env.SETFORK_COUNCIL_MODELS || '' : '')
  const thresholdRaw = ns('cheap_mode_threshold') || legacy('cheap_mode_threshold')

  return {
    // Модель вне allowlist стенда (или пустая) → дефолт провайдера, не битый вызов.
    chatModel: chatRaw && modelAllowed(chatRaw, allowlist) ? chatRaw : chatDefault,
    fallbackModel: fallbackRaw && modelAllowed(fallbackRaw, allowlist) ? fallbackRaw : '',
    councilModels: csv(councilRaw).filter((id) => modelAllowed(id, allowlist)),
    cheapModeThreshold: Math.max(0, Number(thresholdRaw) || 0),
  }
}

export function defaultEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small'
}

/** Синхронная проверка только env-конфига АКТИВНОГО провайдера (без БД). */
export function hasAiEnvConfig(): boolean {
  return Boolean(resolveAiProvider({}, process.env))
}

/** Ключ активного провайдера чата (для «ИИ доступен?» и совместимости). */
export async function getApiKey(): Promise<string> {
  return (await getAiProviderConfig())?.apiKey ?? ''
}

/** Ключ именно OpenRouter (эмбеддинги/кредиты живут там до фазы 2). */
export async function getOpenRouterApiKey(): Promise<string> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, API_KEY_SETTING))
  return (rows[0]?.value?.trim() || process.env.OPENROUTER_API_KEY || '').trim()
}

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await getApiKey())
}

/** Маскирует ключ для показа в UI: «sk-or-v1••••••••1a2b». Полный ключ на клиент не уходит. */
export function maskKey(k: string): string {
  if (!k) return ''
  if (k.length <= 12) return `${k.slice(0, 2)}${'•'.repeat(8)}`
  return `${k.slice(0, 8)}${'•'.repeat(10)}${k.slice(-4)}`
}

export async function getAiSettings(): Promise<AiSettings> {
  const allKeys = [
    ...KEYS,
    PROVIDER_SETTING,
    YANDEX_FOLDER_SETTING,
    ...AI_PROVIDERS.flatMap((p) => NS_MODEL_KEYS.map((k) => nsKey(p, k))),
  ]
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, allKeys))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const providerRaw = m[PROVIDER_SETTING]?.trim() || process.env.AI_PROVIDER || 'openrouter'
  const provider = (AI_PROVIDERS as readonly string[]).includes(providerRaw) ? (providerRaw as AiProviderId) : 'openrouter'
  // Модели/пороги — из неймспейса АКТИВНОГО провайдера (легаси-ключи = фолбэк openrouter).
  const models = resolveModelSettings(m, provider)
  return {
    enabled: m['ai.enabled'] != null ? m['ai.enabled'] === 'true' : hasAiEnvConfig(),
    chatModel: models.chatModel,
    fallbackModel: models.fallbackModel,
    embeddingModel: m['ai.embedding_model'] || defaultEmbeddingModel(),
    temperature: num(m['ai.temperature'], 0.3),
    // 4000, а не 1500: живой бенч (research/2026-07-18-council-bench) — при 1500 ДЛИННЫЕ списки
    // (рецепты/инвентарь) обрезались на полуслове → невалидный JSON → parseList null → 33-56% отказов.
    // При достаточном лимите те же промпты дают 0% отказов. Прод-настройка ai.max_tokens=5000; этот
    // код-дефолт был лэндмайном (сброс настроек вернул бы 1500 и поломку). Кап — платим за факт вывода.
    maxTokens: num(m['ai.max_tokens'], 4000),
    cheapModeThreshold: models.cheapModeThreshold,
    webSearch: m['ai.web_search'] != null ? m['ai.web_search'] === 'true' : process.env.SETFORK_WEB_SEARCH === 'true',
    councilEnabled: m['ai.council_enabled'] != null ? m['ai.council_enabled'] === 'true' : process.env.SETFORK_COUNCIL_ENABLED === 'true',
    councilModels: models.councilModels,
    councilMaxGnomes: num(m['ai.council_max_gnomes'], Number(process.env.SETFORK_COUNCIL_MAX_GNOMES) || 3),
    councilAudience: (m['ai.council_audience'] ?? process.env.SETFORK_COUNCIL_AUDIENCE) === 'all' ? 'all' : 'admin',
    councilWebSeek: m['ai.council_web_seek'] != null ? m['ai.council_web_seek'] === 'true' : process.env.SETFORK_COUNCIL_WEB_SEEK === 'true',
    // ВКЛ по умолчанию (фидбек владельца: «Деплой на VPS» обязан начинаться с
    // вопросов, а clarify на проде молчал — настройка нигде не была включена).
    councilClarify: m['ai.council_clarify'] != null ? m['ai.council_clarify'] === 'true' : process.env.SETFORK_COUNCIL_CLARIFY !== 'false',
    councilMaxPerMonth: num(m['ai.council_max_per_month'], Number(process.env.SETFORK_COUNCIL_MAX_PER_MONTH) || 0),
    // Неизвестное значение → 'off': опечатка в настройке не должна ВКЛЮЧАТЬ трату.
    selfGenMode: m['ai.selfgen_mode'] === 'auto' ? 'auto' : m['ai.selfgen_mode'] === 'manual' ? 'manual' : 'off',
    // Дефолты подняты осознанно: компания должна НАПОЛНЯТЬ портал. 4 за проход × 4
    // пробуждения = до 16 в сутки; денежный потолок всё равно главнее и проверяется на
    // каждом элементе партии.
    selfGenPerDay: num(m['ai.selfgen_per_day'], 16),
    selfGenPerSweep: num(m['ai.selfgen_per_sweep'], 4),
    // Неизвестное значение → 'off' по той же причине: опечатка не должна включать
    // автопубликацию. Планка — самое необратимое из всего, что решает петля.
    readinessMode: m['ai.readiness_mode'] === 'on' ? 'on' : m['ai.readiness_mode'] === 'shadow' ? 'shadow' : 'off',
    readinessMinSteps: num(m['ai.readiness_min_steps'], 5),
    // Неизвестное значение → 'solid' (дефолт планки), а не самая мягкая ступень: ошибка в
    // настройке не должна ОСЛАБЛЯТЬ требования к автопубликации.
    readinessMinGrade: m['ai.readiness_min_grade'] === 'start' ? 'start' : m['ai.readiness_min_grade'] === 'full' ? 'full' : 'solid',
    assistEnabled: m['ai.assist_enabled'] === 'true',
    assistAudience: m['ai.assist_audience'] === 'all' ? 'all' : 'admin',
    freeMonthlyGens: num(m['ai.free_monthly_gens'], Number(process.env.SETFORK_FREE_MONTHLY_GENS) || 0),
  }
}

export async function isAiAvailable(): Promise<boolean> {
  if (!(await hasApiKey())) return false
  const s = await getAiSettings()
  return s.enabled
}
