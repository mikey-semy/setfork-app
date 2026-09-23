import { describe, expect, it } from 'vitest'
import { normalizeHandle, stripHandleInput } from '@/shared/auth/handle-input'
import { normalizeHandle as normalizeFromHandle } from '@/shared/auth/handle'

/**
 * «@» И ПРОБЕЛЫ ВОКРУГ — НЕ ЧАСТЬ НИКА. Одно правило на поле ввода и на сервер:
 * раньше соавторы снимали один «@» без нижнего регистра, перенос — все «@» с ним,
 * поиск людей не снимал вовсе, и «@Mike» находился в одном поле, а в другом нет.
 */
describe('stripHandleInput — поле под пальцем', () => {
  it('снимает ведущие «@» и пробелы, хвостовые пробелы', () => {
    expect(stripHandleInput('@mike')).toBe('mike')
    expect(stripHandleInput('  @ mike  ')).toBe('mike')
    expect(stripHandleInput('@@mike')).toBe('mike')
    expect(stripHandleInput('@')).toBe('')
  })
  it('регистр и «@» внутри не трогает — человек видит, что набрал', () => {
    expect(stripHandleInput('@Mike')).toBe('Mike')
    expect(stripHandleInput('mi@ke')).toBe('mi@ke')
  })
})

describe('normalizeHandle — сверка с БД', () => {
  it('то же снятие «@» плюс нижний регистр', () => {
    expect(normalizeHandle('  @MikeSmith ')).toBe('mikesmith')
    expect(normalizeHandle('@ Mike')).toBe('mike')
  })
  it('серверный модуль handle.ts отдаёт ту же функцию, а не свою копию', () => {
    expect(normalizeFromHandle).toBe(normalizeHandle)
  })
})
