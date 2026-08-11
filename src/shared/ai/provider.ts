import 'server-only'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { type AiProviderConfig } from '@/shared/settings/ai'
import { generationProviderConfig } from './provider-failover'
import { getGigaChatToken } from './gigachat-token'
import { appOrigin } from '@/shared/auth/app-origin'

// Единая точка создания chat-модели для generateText/generateObject.
// Все провайдеры (OpenRouter / Selectel ИИ-роутер / YandexGPT / GigaChat)
// OpenAI-совместимы, поэтому клиент один — @openrouter/ai-sdk-provider с
// кастомным baseURL. OpenRouter-специфика (usage accounting, strict structured
// outputs, extraBody с models/transforms) уходит в body ТОЛЬКО для openrouter:
// чужие OpenAI-compat серверы могут отвергать незнакомые поля.
// GigaChat: cfg.apiKey — это Basic-ключ, Bearer добывается токен-менеджером
// (кеш ~30 мин); их json_schema не поддержан — structured шлёт json_object.

type OpenRouterClient = ReturnType<typeof createOpenRouter>
export type AiChatModel = ReturnType<OpenRouterClient['chat']>

/**
 * Политика данных на стороне OpenRouter.
 *
 * `deny` = маршрутизировать только к провайдерам, которые НЕ хранят промпты и не учатся на них.
 * До этого чужие списки — включая приватные — уезжали в США без единого ограничения на обучение
 * (находка линзы 04, подтверждена живым вызовом в аудите 2026-08-01). Значение по умолчанию
 * именно `deny`: приватность не должна зависеть от того, вспомнил ли кто-то выставить переменную.
 *
 * Рубильник существует, потому что фильтр СУЖАЕТ набор эндпоинтов: у части моделей подходящих
 * провайдеров может не оказаться, и вызов вернёт «No endpoints found». Живьём проверен
 * `gpt-4o-mini`; если завтра назначат модель со своей политикой — `allow` вернёт прежнее
 * поведение без выката кода. Пустое или незнакомое значение читается как `deny`.
 */
export const dataCollectionPolicy = (): 'deny' | 'allow' =>
  process.env.SETFORK_OPENROUTER_DATA_COLLECTION?.trim() === 'allow' ? 'allow' : 'deny'

/**
 * Тело запроса к OpenRouter: то, что просит вызывающий, ПЛЮС наши обязательные условия.
 *
 * Собрано в одном месте намеренно. Раньше `extraBody` формировался по месту вызова (генерация,
 * совет, раскопка, гномы), и «добавить условие во все вызовы» означало не забыть ни одного из
 * них — а забыть легко: приватность как раз и отсутствовала везде.
 */
function openRouterBody(extra?: Record<string, unknown>): Record<string, unknown> {
  const caller = (extra?.provider as Record<string, unknown> | undefined) ?? {}
  return {
    ...extra,
    // Наше условие идёт первым: вызывающий может его переопределить осознанно (например,
    // подобрать ZDR-эндпоинты), но по умолчанию оно есть у каждого вызова.
    provider: { data_collection: dataCollectionPolicy(), ...caller },
  }
}

export interface AiChatClient {
  cfg: AiProviderConfig
  chat(model: string, opts?: { structured?: boolean; extraBody?: Record<string, unknown> }): AiChatModel
}

export async function getAiChatClient(): Promise<AiChatClient | null> {
  // Провайдер ДЛЯ ГЕНЕРАЦИИ: если активный не отвечает, а запасной задан и жив — работаем
  // на запасном. Решение кешируется на минуту, поэтому выбор модели ниже увидит того же.
  const cfg = await generationProviderConfig()
  if (!cfg) return null
  let bearer = cfg.apiKey
  if (cfg.provider === 'gigachat') {
    const token = await getGigaChatToken(cfg.apiKey, process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS')
    if (!token) return null // OAuth не прошёл (ключ/сеть/НУЦ-серт) — ИИ недоступен
    bearer = token
  }
  const client = createOpenRouter({
    apiKey: bearer,
    baseURL: cfg.baseUrl,
    headers: cfg.headers,
    appName: 'SetFork',
    appUrl: appOrigin(),
  })
  const isOpenRouter = cfg.provider === 'openrouter'
  const isGigaChat = cfg.provider === 'gigachat'
  return {
    cfg,
    chat: (model, opts) => {
      if (isOpenRouter)
        return client.chat(model, {
          usage: { include: true },
          ...(opts?.structured ? { structuredOutputs: { strict: true } } : {}),
          // extraBody теперь есть ВСЕГДА: даже когда вызывающему нечего добавить, наша
          // политика данных должна доехать до провайдера.
          extraBody: openRouterBody(opts?.extraBody),
        })
      // GigaChat json_schema не принимает («Empty schema…») — просим json_object,
      // схему модель видит в промпте generateObject; валидация у нас по zod.
      if (isGigaChat && opts?.structured)
        return client.chat(model, { extraBody: { response_format: { type: 'json_object' } } })
      return client.chat(model)
    },
  }
}
