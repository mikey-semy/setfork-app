import { describe, expect, it } from 'vitest'
import { modelAllowed, nsKey, parseModelAllowlist, resolveModelSettings } from '@/shared/settings/ai'

describe('resolveModelSettings', () => {
  it('неймспейс активного провайдера сильнее всего', () => {
    const m = {
      [nsKey('yandex', 'chat_model')]: 'gpt://b1g/qwen3.6-35b-a3b/latest',
      'ai.chat_model': 'openai/gpt-4o-mini', // легаси — не для яндекса
    }
    expect(resolveModelSettings(m, 'yandex', {}).chatModel).toBe('gpt://b1g/qwen3.6-35b-a3b/latest')
  })

  it('легаси-ключи — фолбэк ТОЛЬКО для openrouter', () => {
    const m = { 'ai.chat_model': 'anthropic/claude-sonnet-5', 'ai.council_models': 'a/x, b/y' }
    expect(resolveModelSettings(m, 'openrouter', {}).chatModel).toBe('anthropic/claude-sonnet-5')
    expect(resolveModelSettings(m, 'openrouter', {}).councilModels).toEqual(['a/x', 'b/y'])
    const ya = resolveModelSettings({ ...m, 'ai.yandex_folder_id': 'b1g' }, 'yandex', {})
    expect(ya.chatModel).toBe('gpt://b1g/yandexgpt-5.1/latest') // дефолт, не легаси
    expect(ya.councilModels).toEqual([])
  })

  it('пустой неймспейс → дефолт провайдера (yandex собирает из folder)', () => {
    expect(resolveModelSettings({}, 'openrouter', {}).chatModel).toBe('openai/gpt-4o-mini')
    expect(resolveModelSettings({ 'ai.yandex_folder_id': 'b1gx' }, 'yandex', {}).chatModel).toBe(
      'gpt://b1gx/yandexgpt-5.1/latest',
    )
    expect(resolveModelSettings({}, 'yandex', { YC_AI_FOLDER_ID: 'b1genv' }).chatModel).toBe(
      'gpt://b1genv/yandexgpt-5.1/latest',
    )
  })

  it('порог cheap-mode пер-провайдерный: смена провайдера не тащит чужой смысл', () => {
    const m = {
      [nsKey('openrouter', 'cheap_mode_threshold')]: '5',
      [nsKey('yandex', 'cheap_mode_threshold')]: '300',
    }
    expect(resolveModelSettings(m, 'openrouter', {}).cheapModeThreshold).toBe(5)
    expect(resolveModelSettings(m, 'yandex', {}).cheapModeThreshold).toBe(300)
    expect(resolveModelSettings({}, 'yandex', {}).cheapModeThreshold).toBe(0)
  })

  it('allowlist стенда: чужая модель → дефолт, пул фильтруется', () => {
    const env = { AI_MODEL_ALLOWLIST: 'gpt://,emb://', YC_AI_FOLDER_ID: 'b1g' }
    const m = {
      [nsKey('yandex', 'chat_model')]: 'openai/gpt-4o-mini', // вне allowlist
      [nsKey('yandex', 'council_models')]: 'gpt://b1g/gpt-oss-120b/latest, openai/gpt-4o',
    }
    const r = resolveModelSettings(m, 'yandex', env)
    expect(r.chatModel).toBe('gpt://b1g/yandexgpt-5.1/latest')
    expect(r.councilModels).toEqual(['gpt://b1g/gpt-oss-120b/latest'])
  })
})

describe('parseModelAllowlist / modelAllowed', () => {
  it('пустой allowlist разрешает всё; префиксы работают', () => {
    expect(modelAllowed('anything', parseModelAllowlist({}))).toBe(true)
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: 'gpt://, qwen/' })
    expect(modelAllowed('gpt://b1g/yandexgpt-5.1/latest', list)).toBe(true)
    expect(modelAllowed('qwen/qwen3.6-27b', list)).toBe(true)
    expect(modelAllowed('openai/gpt-4o-mini', list)).toBe(false)
  })
})
