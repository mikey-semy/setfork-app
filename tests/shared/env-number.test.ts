import { afterEach, describe, expect, it, vi } from 'vitest'
import { envNumber } from '@/shared/env'

// Числовые настройки денег читаются на старте модуля, и мусор в них раньше расходился в
// ДВЕ разные стороны: дневной кап тихо выключался (NaN > 0 === false), месячная квота тихо
// закрывалась всем (used < NaN === false). Правило теперь одно — непонятное значение это
// «не задано»: дефолт и предупреждение в лог.

const KEY = 'SETFORK_TEST_NUMBER'
afterEach(() => {
  delete process.env[KEY]
  vi.restoreAllMocks()
})

describe('envNumber', () => {
  it('число читается как число, в том числе дробное', () => {
    process.env[KEY] = '12.5'
    expect(envNumber(KEY, 1)).toBe(12.5)
  })

  it('явный ноль остаётся нулём — так осознанно выключают кап', () => {
    process.env[KEY] = '0'
    expect(envNumber(KEY, 10)).toBe(0)
  })

  it('переменной нет или она пустая — дефолт', () => {
    expect(envNumber(KEY, 7)).toBe(7)
    process.env[KEY] = '   '
    expect(envNumber(KEY, 7)).toBe(7)
  })

  it('мусор — ДЕФОЛТ и предупреждение, а не NaN', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const bad of ['10 usd', '10$', 'много', 'ten']) {
      process.env[KEY] = bad
      expect(envNumber(KEY, 10)).toBe(10)
    }
    expect(warn).toHaveBeenCalledTimes(4)
  })

  it('отрицательное значение считается мусором (лимитов «меньше нуля» не бывает)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env[KEY] = '-5'
    expect(envNumber(KEY, 10)).toBe(10)
  })
})
