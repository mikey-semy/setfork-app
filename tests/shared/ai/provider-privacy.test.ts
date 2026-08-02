import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Приватность запросов к OpenRouter.
 *
 * Линза 04 и живой аудит 2026-08-01: чужие списки — включая приватные — уезжали в США без
 * единого ограничения на обучение. Условие обязано ехать с КАЖДЫМ вызовом, поэтому живёт не по
 * месту вызова (там его легко забыть — и забыли везде), а в единственной фабрике chat-моделей.
 */

/** Параметры объявлены явно: иначе у vi.fn нет типа аргументов и до `mock.calls[…][1]`
 *  (тело запроса — единственное, что здесь проверяется) не добраться. */
const chat = vi.fn((_model: string, _opts?: Record<string, unknown>) => ({ id: 'model' }))
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: () => ({ chat }) }))
vi.mock('@/shared/ai/gigachat-token', () => ({ getGigaChatToken: async () => 'tok' }))

const providerCfg = vi.fn(async () => ({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }))
// Конфиг берётся через failover-слой (он умеет уводить генерацию на запасного провайдера),
// поэтому подменяем именно его — не настройки.
vi.mock('@/shared/ai/provider-failover', () => ({ generationProviderConfig: () => providerCfg() }))

const { getAiChatClient } = await import('@/shared/ai/provider')

/** Тело, с которым фабрика позвала SDK. */
const bodyOf = () => (chat.mock.calls.at(-1)?.[1] as { extraBody?: Record<string, unknown> } | undefined)?.extraBody

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.SETFORK_OPENROUTER_DATA_COLLECTION
})

describe('политика данных OpenRouter', () => {
  it('запрет на сбор едет с вызовом, даже когда добавлять больше нечего', async () => {
    const client = await getAiChatClient()
    client?.chat('openai/gpt-4o-mini')

    expect(bodyOf()?.provider).toEqual({ data_collection: 'deny' })
  })

  it('поля вызывающего не теряются — они про маршрутизацию, мы про приватность', async () => {
    const client = await getAiChatClient()
    client?.chat('openai/gpt-4o-mini', { extraBody: { models: ['a', 'b'], transforms: ['middle-out'] } })

    expect(bodyOf()).toMatchObject({ models: ['a', 'b'], transforms: ['middle-out'], provider: { data_collection: 'deny' } })
  })

  it('осознанное переопределение возможно (ZDR-эндпоинты подбирают этим же полем)', async () => {
    const client = await getAiChatClient()
    client?.chat('openai/gpt-4o-mini', { extraBody: { provider: { zdr: true, data_collection: 'allow' } } })

    expect(bodyOf()?.provider).toEqual({ zdr: true, data_collection: 'allow' })
  })

  it('рубильник на случай «No endpoints found»: allow возвращает прежнее поведение', async () => {
    process.env.SETFORK_OPENROUTER_DATA_COLLECTION = 'allow'
    const client = await getAiChatClient()
    client?.chat('openai/gpt-4o-mini')

    expect(bodyOf()?.provider).toEqual({ data_collection: 'allow' })
  })

  it('мусор в переменной читается как запрет — приватность не должна зависеть от опечатки', async () => {
    process.env.SETFORK_OPENROUTER_DATA_COLLECTION = 'ALLOW_MAYBE'
    const client = await getAiChatClient()
    client?.chat('openai/gpt-4o-mini')

    expect(bodyOf()?.provider).toEqual({ data_collection: 'deny' })
  })

  it('чужие OpenAI-совместимые серверы наших полей не видят — они их не понимают', async () => {
    providerCfg.mockResolvedValueOnce({ provider: 'selectel', baseUrl: 'https://x/v1', apiKey: 'k' })
    const client = await getAiChatClient()
    client?.chat('some/model')

    expect(chat.mock.calls.at(-1)?.[1]).toBeUndefined()
  })
})
