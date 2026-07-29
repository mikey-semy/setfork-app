import { describe, expect, it } from 'vitest'
import { modelAllowed, parseModelAllowlist } from '@/shared/settings/ai'

/**
 * БЕЛЫЙ СПИСОК МОДЕЛЕЙ — ограничение владельца: «в проде разрешено только это».
 *
 * Его заводят, чтобы дорогая или неподходящая модель не ушла в работу. Проверка
 * `usable` применяет его к моделям личных специалистов, а пул совета собирался
 * фильтром одного лишь провайдера — то есть ограничение обходилось самым дорогим
 * путём: быстрой моделью, ротацией экспертов, критиком и старейшиной.
 *
 * Здесь проверяется само правило, на которое опирается пул после правки.
 */
describe('правило белого списка', () => {
  it('пустой список ничего не ограничивает', () => {
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: '' })
    expect(modelAllowed('openai/gpt-4o', list)).toBe(true)
    expect(modelAllowed('дорогая/модель', list)).toBe(true)
  })

  it('заданный список пропускает только своих', () => {
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: 'openai/gpt-4o, anthropic/claude' })
    expect(modelAllowed('openai/gpt-4o', list)).toBe(true)
    expect(modelAllowed('anthropic/claude', list)).toBe(true)
    expect(modelAllowed('openai/o1-pro', list)).toBe(false)
  })

  it('суффиксы вроде :online не выводят модель из-под списка', () => {
    const list = parseModelAllowlist({ AI_MODEL_ALLOWLIST: 'openai/gpt-4o' })
    expect(modelAllowed('openai/gpt-4o:online', list)).toBe(true)
  })
})
