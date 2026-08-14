import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Приватность эмбеддингов.
 *
 * Их легко упустить: они идут МИМО фабрики chat-моделей — свой HTTP-вызов на `/embeddings`.
 * Между тем именно туда уезжает СОДЕРЖИМОЕ списков целиком, включая приватные (находка
 * авто-ревью по #654: запрет, добавленный в provider.ts, этих запросов не касался).
 */

vi.mock('@/shared/settings/ai', async (orig) => ({
  ...(await orig()),
  getOpenRouterApiKey: async () => 'k',
  getAiProviderRaw: async () => ({ yandexKey: 'yk', yandexFolder: 'f' }),
}))
vi.mock('@/shared/ai/usage', () => ({ recordUsage: async () => {} }))

const space = vi.fn(async () => ({ provider: 'openrouter', docModel: 'openai/text-embedding-3-small', queryModel: 'openai/text-embedding-3-small', dim: 768 }))
vi.mock('@/shared/ai/embed-space', async (orig) => ({ ...(await orig()), getIndexSpace: () => space() }))

const { embedTexts } = await import('@/shared/ai/embeddings')

const okBody = { data: [{ embedding: new Array(768).fill(0.1), index: 0 }], usage: { total_tokens: 5 } }

/** Тело, ушедшее провайдеру. */
const sentBody = (spy: ReturnType<typeof vi.spyOn>) => JSON.parse((spy.mock.calls.at(-1)?.[1] as RequestInit).body as string)

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.SETFORK_OPENROUTER_DATA_COLLECTION
})

describe('политика данных для эмбеддингов', () => {
  it('запрет на сбор едет вместе с текстами списка', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }))

    await embedTexts(['приватный список пользователя'], 'doc')

    expect(sentBody(spy).provider).toEqual({ data_collection: 'deny' })
  })

  it('рубильник действует и здесь — политика одна на все вызовы', async () => {
    process.env.SETFORK_OPENROUTER_DATA_COLLECTION = 'allow'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }))

    await embedTexts(['текст'], 'query')

    expect(sentBody(spy).provider).toEqual({ data_collection: 'allow' })
  })

  it('кеш запросов привязан к ПРОСТРАНСТВУ: после реиндекса в другой мерности вектор берётся заново', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }))

    await embedTexts(['одна и та же формулировка'], 'query')
    await embedTexts(['одна и та же формулировка'], 'query') // то же пространство — берём из кеша
    expect(spy).toHaveBeenCalledTimes(1)

    // Реиндекс перевёл индекс в 1536: старый 768-мерный вектор запроса несравним со
    // свежими документами, и отдать его из кеша значило бы тихо испортить ранжирование.
    space.mockResolvedValueOnce({ provider: 'openrouter', docModel: 'openai/text-embedding-3-small', queryModel: 'openai/text-embedding-3-small', dim: 1536 })
    await embedTexts(['одна и та же формулировка'], 'query')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('Яндексу наших полей не шлём — он их не понимает', async () => {
    space.mockResolvedValueOnce({ provider: 'yandex', docModel: 'emb-doc', queryModel: 'emb-query', dim: 768 })
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }))

    await embedTexts(['текст'], 'doc')

    expect(sentBody(spy).provider).toBeUndefined()
  })
})
