import { describe, expect, it } from 'vitest'
import { howToEligible } from '@/shared/seo/howto-eligible'

/**
 * КОГДА СПИСОК ОБЪЯВЛЯЕТ СЕБЯ ИНСТРУКЦИЕЙ.
 *
 * Условие жило прямо в разметке страницы, и авто-ревью находило в нём дыру пять раз
 * подряд: тип списка, старая версия, фильтр `?find=`, обрезка шагов. Каждая дыра — это
 * `HowTo`, говорящий поисковику больше, чем показано на странице. Здесь каждое условие
 * проверено по отдельности: ровно одно нарушено — разметки нет.
 */
const ok = { ordered: true, listKind: 'procedure', readOnlyView: false, find: '', firstLockedIdx: -1, stepCount: 3 }

describe('HowTo на странице списка', () => {
  it('обычная процедура — да', () => {
    expect(howToEligible(ok)).toBe(true)
  })

  it('пустой тип читается как процедура', () => {
    expect(howToEligible({ ...ok, listKind: null })).toBe(true)
    expect(howToEligible({ ...ok, listKind: undefined })).toBe(true)
  })

  it.each([
    ['неупорядоченный', { ordered: false }],
    ['рецепт', { listKind: 'recipe' }],
    ['чеклист', { listKind: 'checklist' }],
    ['старая версия или ветка', { readOnlyView: true }],
    ['отфильтрован ?find=', { find: 'docker' }],
    ['у ученика заперты уроки', { firstLockedIdx: 4 }],
    ['ни одного шага', { stepCount: 0 }],
  ])('%s — нет', (_, patch) => {
    expect(howToEligible({ ...ok, ...patch })).toBe(false)
  })
})
