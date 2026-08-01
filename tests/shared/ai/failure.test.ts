import { describe, it, expect } from 'vitest'
import { parseFailure, serializeFailure } from '@/shared/ai/failure'

describe('причина провала генерации', () => {
  it('переживает круг сериализации', () => {
    const raw = serializeFailure({ code: 'invalid', model: 'openai/gpt-4o-mini:online', detail: 'Sorry, I cannot help.' })
    expect(parseFailure(raw)).toEqual({ code: 'invalid', model: 'openai/gpt-4o-mini:online', detail: 'Sorry, I cannot help.' })
  })

  it('старая реплика ошибки (пустой текст) — это «подробностей нет», а не поломка', () => {
    expect(parseFailure('')).toBeNull()
    expect(parseFailure('Не получилось')).toBeNull()
    expect(parseFailure('{битый json')).toBeNull()
    expect(parseFailure(JSON.stringify({ code: 'выдуманный' }))).toBeNull()
  })

  it('ключ из эха заголовка не доезжает до буфера обмена', () => {
    const raw = serializeFailure({ code: 'error', detail: 'AI_APICallError: 401 {"authorization":"Bearer sk-or-v1-deadbeefcafe"}' })
    expect(raw).not.toContain('sk-or-v1-deadbeefcafe')
    expect(parseFailure(raw)?.detail).toContain('401')
  })

  it('длинный ответ модели режется — реплика остаётся строкой, а не простынёй', () => {
    const raw = serializeFailure({ code: 'invalid', detail: 'x'.repeat(5000) })
    expect((parseFailure(raw)?.detail ?? '').length).toBeLessThanOrEqual(600)
  })
})
