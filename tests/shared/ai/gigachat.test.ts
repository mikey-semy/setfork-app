import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAiProvider, defaultChatModelFor, GIGACHAT_KEY_SETTING, PROVIDER_SETTING } from '@/shared/settings/ai'
import { clearGigaChatTokenCache, getGigaChatToken } from '@/shared/ai/gigachat-token'

describe('resolveAiProvider: gigachat', () => {
  it('нужен Basic-ключ (БД или env); apiKey конфига = этот ключ', () => {
    expect(resolveAiProvider({ [PROVIDER_SETTING]: 'gigachat' }, {})).toBeNull()
    const cfg = resolveAiProvider({ [PROVIDER_SETTING]: 'gigachat', [GIGACHAT_KEY_SETTING]: 'basic-key' }, {})
    expect(cfg).toMatchObject({
      provider: 'gigachat',
      baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1',
      apiKey: 'basic-key',
    })
    expect(resolveAiProvider({}, { AI_PROVIDER: 'gigachat', GIGACHAT_AUTH_KEY: 'env-key' })?.apiKey).toBe('env-key')
  })

  it('дефолтная модель GigaChat-2 (env переопределяет)', () => {
    expect(defaultChatModelFor('gigachat', '', {})).toBe('GigaChat-2')
    expect(defaultChatModelFor('gigachat', '', { GIGACHAT_CHAT_MODEL: 'GigaChat-2-Max' })).toBe('GigaChat-2-Max')
  })
})

describe('getGigaChatToken', () => {
  beforeEach(() => clearGigaChatTokenCache())
  afterEach(() => vi.restoreAllMocks())

  const okResponse = (token: string, expiresAt: number) =>
    new Response(JSON.stringify({ access_token: token, expires_at: expiresAt }), { status: 200 })

  it('кеширует токен до истечения и не дёргает oauth повторно', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('tok-1', Date.now() + 30 * 60_000))
    expect(await getGigaChatToken('key', 'GIGACHAT_API_PERS')).toBe('tok-1')
    expect(await getGigaChatToken('key', 'GIGACHAT_API_PERS')).toBe('tok-1')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('истёкший токен обновляется; expires_at в секундах тоже понимается', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse('tok-old', Date.now() - 1000))
      .mockResolvedValueOnce(okResponse('tok-new', Math.floor(Date.now() / 1000) + 1800)) // секунды
    expect(await getGigaChatToken('key', 's')).toBe('tok-old')
    expect(await getGigaChatToken('key', 's')).toBe('tok-new')
    expect(await getGigaChatToken('key', 's')).toBe('tok-new') // из кеша
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('смена ключа инвалидирует кеш; ошибка сети отдаёт старый токен', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse('tok-a', Date.now() + 30 * 60_000))
      .mockResolvedValueOnce(okResponse('tok-b', Date.now() + 30 * 60_000))
    expect(await getGigaChatToken('key-a', 's')).toBe('tok-a')
    expect(await getGigaChatToken('key-b', 's')).toBe('tok-b') // другой ключ → новый обмен
    expect(spy).toHaveBeenCalledTimes(2)
    expect(await getGigaChatToken('', 's')).toBeNull()
  })
})
