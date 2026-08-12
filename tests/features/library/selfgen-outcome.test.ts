import { describe, expect, it } from 'vitest'
import { selfGenStatus } from '@/features/library/selfgen'

// От этой классификации зависит, погасит ли предохранитель петлю самогенерации: он считает
// пять «ошибок» подряд поводом остановиться. Пять неудачных тем или почти-дублей означают
// ровно обратное — петля работает и честно ничего не выдумывает.

describe('исход самогенерации в журнале', () => {
  it('черновик написан — ok', () => {
    expect(selfGenStatus(undefined)).toBe('ok')
    expect(selfGenStatus('')).toBe('ok')
  })

  it('работа не нашлась — пропуск, а не отказ петли', () => {
    expect(selfGenStatus('no-topic')).toBe('skipped')
    expect(selfGenStatus('near-duplicate')).toBe('skipped')
  })

  it('условия не позволили начать — тоже пропуск: у обоих случаев свой сторож', () => {
    // Пустой канал сторожит `aiwatch`, исчерпанный бюджет — бухгалтер. Гасить за это ещё
    // и петлю значит наказывать её за чужую поломку.
    expect(selfGenStatus('ai-unavailable')).toBe('skipped')
    expect(selfGenStatus('budget-exhausted')).toBe('skipped')
  })

  it('модель не отдала список или гнома некем подписать — настоящий отказ', () => {
    expect(selfGenStatus('generation-failed')).toBe('error')
    expect(selfGenStatus('no-account')).toBe('error')
    expect(selfGenStatus('expert-not-found')).toBe('error')
  })

  it('незнакомый код считается отказом: молчаливое «сойдёт» опаснее лишней тревоги', () => {
    expect(selfGenStatus('whatever-new-code')).toBe('error')
  })
})
