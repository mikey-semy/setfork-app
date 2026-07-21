import 'server-only'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiProviderConfig, type AiProviderConfig } from '@/shared/settings/ai'
import { getGigaChatToken } from './gigachat-token'

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

export interface AiChatClient {
  cfg: AiProviderConfig
  chat(model: string, opts?: { structured?: boolean; extraBody?: Record<string, unknown> }): AiChatModel
}

export async function getAiChatClient(): Promise<AiChatClient | null> {
  const cfg = await getAiProviderConfig()
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
    appUrl: process.env.APP_URL || 'http://localhost:3000',
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
          ...(opts?.extraBody ? { extraBody: opts.extraBody } : {}),
        })
      // GigaChat json_schema не принимает («Empty schema…») — просим json_object,
      // схему модель видит в промпте generateObject; валидация у нас по zod.
      if (isGigaChat && opts?.structured)
        return client.chat(model, { extraBody: { response_format: { type: 'json_object' } } })
      return client.chat(model)
    },
  }
}
