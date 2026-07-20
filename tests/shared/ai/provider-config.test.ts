import { describe, expect, it } from 'vitest'
import { resolveAiProvider, API_KEY_SETTING, PROVIDER_SETTING, SELECTEL_KEY_SETTING, YANDEX_KEY_SETTING } from '@/shared/settings/ai'

describe('resolveAiProvider', () => {
  it('дефолт: openrouter из env-ключа; без ключа — null', () => {
    expect(resolveAiProvider({}, {})).toBeNull()
    const cfg = resolveAiProvider({}, { OPENROUTER_API_KEY: 'sk-or-x' })
    expect(cfg).toMatchObject({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x' })
  })

  it('админ-ключ из БД сильнее env (openrouter)', () => {
    const cfg = resolveAiProvider({ [API_KEY_SETTING]: 'sk-db' }, { OPENROUTER_API_KEY: 'sk-env' })
    expect(cfg?.apiKey).toBe('sk-db')
  })

  it('selectel: нужен и endpoint, и ключ; хвостовой слэш срезается', () => {
    expect(resolveAiProvider({}, { AI_PROVIDER: 'selectel', SELECTEL_AI_KEY: 'k' })).toBeNull()
    expect(resolveAiProvider({}, { AI_PROVIDER: 'selectel', SELECTEL_AI_URL: 'https://x/v1' })).toBeNull()
    const cfg = resolveAiProvider({}, { AI_PROVIDER: 'selectel', SELECTEL_AI_URL: 'https://x/v1/', SELECTEL_AI_KEY: 'k' })
    expect(cfg).toMatchObject({ provider: 'selectel', baseUrl: 'https://x/v1', apiKey: 'k' })
  })

  it('yandex: ключ + folder_id, заголовки с x-folder-id и запретом логирования', () => {
    expect(resolveAiProvider({}, { AI_PROVIDER: 'yandex', YC_AI_API_KEY: 'k' })).toBeNull()
    const cfg = resolveAiProvider({}, { AI_PROVIDER: 'yandex', YC_AI_API_KEY: 'k', YC_AI_FOLDER_ID: 'b1gtest' })
    expect(cfg).toMatchObject({
      provider: 'yandex',
      baseUrl: 'https://llm.api.cloud.yandex.net/v1',
      apiKey: 'k',
      headers: { 'x-folder-id': 'b1gtest', 'x-data-logging-enabled': 'false' },
    })
  })

  it('настройка ai.provider из БД сильнее env AI_PROVIDER', () => {
    const cfg = resolveAiProvider(
      { [PROVIDER_SETTING]: 'yandex', [YANDEX_KEY_SETTING]: 'yk' },
      { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk', YC_AI_FOLDER_ID: 'b1g' },
    )
    expect(cfg?.provider).toBe('yandex')
    expect(cfg?.apiKey).toBe('yk')
  })

  it('ключ selectel может лежать в БД (ai.selectel_api_key)', () => {
    const cfg = resolveAiProvider(
      { [PROVIDER_SETTING]: 'selectel', [SELECTEL_KEY_SETTING]: 'dbk' },
      { SELECTEL_AI_URL: 'https://x/v1' },
    )
    expect(cfg?.apiKey).toBe('dbk')
  })
})
