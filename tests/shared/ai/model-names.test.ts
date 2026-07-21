import { describe, expect, it } from 'vitest'
import { modelFamily, prettyModelName } from '@/shared/ai/models'

describe('prettyModelName', () => {
  it('яндексовые URI → короткое имя, latest прячется, прочие версии в скобках', () => {
    expect(prettyModelName('gpt://b1g1x/yandexgpt-5.1/latest')).toBe('yandexgpt-5.1')
    expect(prettyModelName('gpt://b1g1x/yandexgpt-lite/rc')).toBe('yandexgpt-lite (rc)')
    expect(prettyModelName('emb://b1g1x/text-embeddings-v2-doc/latest')).toBe('text-embeddings-v2-doc')
  })

  it('дообученная модель сохраняет суффикс', () => {
    expect(prettyModelName('gpt://b1g1x/yandexgpt-lite/latest@my-tune')).toBe('yandexgpt-lite@my-tune')
  })

  it('vendor/model → model; голый id как есть', () => {
    expect(prettyModelName('openai/gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(prettyModelName('anthropic/claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(prettyModelName('solo-model')).toBe('solo-model')
  })
})

describe('modelFamily', () => {
  it('owned_by сильнее всего (кроме заглушки gateway)', () => {
    expect(modelFamily('gpt://b1g/deepseek-v32/latest', 'DeepSeek')).toBe('DeepSeek')
    expect(modelFamily('openai/gpt-4o-mini', 'gateway')).toBe('Openai')
  })

  it('вендор из префикса id и эвристики для URI', () => {
    expect(modelFamily('qwen/qwen3.6-27b')).toBe('Qwen')
    expect(modelFamily('gpt://b1g/yandexgpt-5.1/latest')).toBe('Yandex')
    expect(modelFamily('gpt://b1g/aliceai-llm-flash/latest')).toBe('Yandex')
    expect(modelFamily('gpt://b1g/gpt-oss-120b/latest')).toBe('OpenAI')
  })
})
