import { describe, expect, it } from 'vitest'
import { addClosingRef, closingRefs, removeClosingRef } from '@/features/library/closing-refs'

const NL = '\n'

describe('closingRefs', () => {
  it('находит английские и русские формы', () => {
    expect(closingRefs('closes #12')).toEqual([12])
    expect(closingRefs('Fixes: #7 и ещё resolves #9')).toEqual([7, 9])
    expect(closingRefs('закрывает #3')).toEqual([3])
    expect(closingRefs('Это решает #42 наконец')).toEqual([42])
  })

  it('регистр не важен, двоеточие необязательно', () => {
    expect(closingRefs('CLOSES #5')).toEqual([5])
    expect(closingRefs('Closed: #5')).toEqual([5])
  })

  it('простое упоминание НЕ закрывает', () => {
    // Иначе «как в #12» молча закрыло бы чужую задачу.
    expect(closingRefs('см. #12')).toEqual([])
    expect(closingRefs('#12')).toEqual([])
    expect(closingRefs('обсуждали в #12 и #13')).toEqual([])
  })

  it('дубли сворачиваются, порядок сохраняется', () => {
    expect(closingRefs('closes #4, fixes #4, resolves #2')).toEqual([4, 2])
  })

  it('слово-часть другого слова не срабатывает', () => {
    expect(closingRefs('unclosed #8')).toEqual([])
    expect(closingRefs('discloses #8')).toEqual([])
  })

  it('пустой и мусорный вход', () => {
    expect(closingRefs('')).toEqual([])
    expect(closingRefs('closes #0')).toEqual([])
    expect(closingRefs('closes #')).toEqual([])
  })
})

/**
 * Пикер привязки задачи правит ТЕКСТ предложения. Ошибка здесь не падает, а
 * молча портит чужое описание: снесли лишнее — потеряли смысл, не снесли —
 * задача осталась привязанной вопреки нажатию.
 */
describe('addClosingRef / removeClosingRef', () => {
  it('привязка дописывается отдельной строкой и не дублируется', () => {
    expect(addClosingRef('Правит деплой', 12)).toBe(`Правит деплой${NL}closes #12`)
    expect(closingRefs(addClosingRef('Правит деплой', 12))).toEqual([12])
    const once = addClosingRef('Правит деплой', 12)
    expect(addClosingRef(once, 12)).toBe(once) // повтор ничего не меняет
  })

  it('привязка к пустому тексту не оставляет пустой строки в начале', () => {
    expect(addClosingRef('', 7)).toBe('closes #7')
  })

  it('отвязка убирает ТОЛЬКО свою ссылку', () => {
    const text = `Правит деплой${NL}closes #12${NL}closes #13`
    expect(closingRefs(removeClosingRef(text, 12))).toEqual([13])
    expect(removeClosingRef(text, 12)).toContain('Правит деплой')
  })

  it('отвязка не оставляет дыр в тексте', () => {
    const out = removeClosingRef(`Правит деплой${NL}closes #12${NL}${NL}Хвост`, 12)
    expect(out).not.toMatch(/\n{3,}/)
    expect(out).toContain('Хвост')
  })

  it('русская форма отвязывается так же, как английская', () => {
    expect(closingRefs(removeClosingRef('Правит деплой закрывает #5', 5))).toEqual([])
  })

  it('отвязка несуществующей ссылки ничего не портит', () => {
    expect(removeClosingRef('Правит деплой', 99)).toBe('Правит деплой')
  })
})
