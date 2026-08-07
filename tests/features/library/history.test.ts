import { describe, expect, it } from 'vitest'
import { amendStep, canRedo, canUndo, commitStep, currentStep, startHistory, stepHistory } from '@/features/library/list-editor/history'

/**
 * ОТМЕНА НЕ ДОЛЖНА ВОСКРЕШАТЬ ЧУЖОЕ БУДУЩЕЕ.
 *
 * Правка после отмены обрубает ветку вперёд — иначе «повторить» возвращает состояние,
 * построенное на другом прошлом, и молча съедает только что набранное. Раньше это
 * правило соблюдал только `commit`, а правка содержимого — нет.
 */
const h0 = startHistory('a')

describe('история снимков', () => {
  it('шаг добавляется, отмена и повтор ходят по нему', () => {
    const h = commitStep(h0, 'b')
    expect(currentStep(h)).toBe('b')
    expect(canUndo(h)).toBe(true)
    expect(canRedo(h)).toBe(false)

    const back = stepHistory(h, -1)
    expect(currentStep(back)).toBe('a')
    expect(canRedo(back)).toBe(true)
    expect(currentStep(stepHistory(back, 1))).toBe('b')
  })

  it('за краями истории ничего не происходит', () => {
    expect(stepHistory(h0, -1)).toBe(h0)
    expect(stepHistory(h0, 1)).toBe(h0)
  })

  it('правка содержимого заменяет верхний снимок, а не добавляет шаг', () => {
    const h = amendStep(commitStep(h0, 'b'), 'b+')
    expect(currentStep(h)).toBe('b+')
    // Один шаг вниз — исходное состояние, а не промежуточная буква.
    expect(currentStep(stepHistory(h, -1))).toBe('a')
  })

  it('новый шаг после отмены обрубает ветку вперёд', () => {
    const h = stepHistory(commitStep(h0, 'b'), -1)
    const next = commitStep(h, 'c')
    expect(currentStep(next)).toBe('c')
    expect(canRedo(next)).toBe(false)
  })

  it('правка содержимого после отмены тоже обрубает: повторить нечего', () => {
    const h = stepHistory(commitStep(h0, 'b'), -1)
    const next = amendStep(h, 'a+')
    expect(currentStep(next)).toBe('a+')
    expect(canRedo(next)).toBe(false)
    // И «b» больше не всплывёт: оно строилось на другом прошлом.
    expect(next.steps).toEqual(['a+'])
  })
})
