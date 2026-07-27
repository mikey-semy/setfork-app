import { describe, expect, it } from 'vitest'
import { closingRefs } from '@/features/library/closing-refs'

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
