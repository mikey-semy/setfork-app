import 'server-only'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiProviderConfig, type AiProviderConfig } from '@/shared/settings/ai'

// Единая точка создания chat-модели для generateText/generateObject.
// Все провайдеры (OpenRouter / Selectel ИИ-роутер / YandexGPT) OpenAI-совместимы,
// поэтому клиент один — @openrouter/ai-sdk-provider с кастомным baseURL.
// OpenRouter-специфика (usage accounting, strict structured outputs, extraBody
// с models/transforms) уходит в body ТОЛЬКО для openrouter: чужие OpenAI-compat
// серверы могут отвергать незнакомые поля.

type OpenRouterClient = ReturnType<typeof createOpenRouter>
export type AiChatModel = ReturnType<OpenRouterClient['chat']>

export interface AiChatClient {
  cfg: AiProviderConfig
  chat(model: string, opts?: { structured?: boolean; extraBody?: Record<string, unknown> }): AiChatModel
}

export async function getAiChatClient(): Promise<AiChatClient | null> {
  const cfg = await getAiProviderConfig()
  if (!cfg) return null
  const client = createOpenRouter({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    headers: cfg.headers,
    appName: 'SetFork',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  })
  const isOpenRouter = cfg.provider === 'openrouter'
  return {
    cfg,
    chat: (model, opts) =>
      isOpenRouter
        ? client.chat(model, {
            usage: { include: true },
            ...(opts?.structured ? { structuredOutputs: { strict: true } } : {}),
            ...(opts?.extraBody ? { extraBody: opts.extraBody } : {}),
          })
        : client.chat(model),
  }
}
