import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ОТКАЗ ГЕЙТА ЗАПИСИ: ДВА СЛУЧАЯ — ДВА СОВЕТА.
 *
 * Ядро с 25.08.2026 различает «связь с проверкой сорвалась» (повтор осмыслен) и
 * «проверка ответила непонятно» (разошлись версии, повтор бесполезен). До 26.08 фронт
 * складывал оба в код порта `internal` с единственным текстом «Ошибка, попробуйте ещё
 * раз» — для второго случая это прямо вредный совет: человек будет жать кнопку, пока
 * не сдастся, хотя починка не в его руках.
 *
 * Тест держит ТРИ вещи, каждая из которых ломается независимо:
 *  1. обе причины разбираются таблицей (иначе человек снова получит общую ошибку);
 *  2. они дают РАЗНЫЕ коды порта (иначе разведение бессмысленно);
 *  3. у каждого кода есть свой текст в обоих словарях — и тексты тоже разные.
 *
 * ⚠️ Имена причин — контракт с ядром: `check-proto-sync.sh` сверяет МНОЖЕСТВА причин с
 * `src/reason.rs` в обе стороны. Переименование здесь красит CI ядра.
 */

const remote = readFileSync('src/features/git/core.remote.ts', 'utf8')
const ru = readFileSync('src/shared/i18n/dict/ru.ts', 'utf8')
const en = readFileSync('src/shared/i18n/dict/en.ts', 'utf8')

const table = remote.slice(remote.indexOf('REASON_TO_CODE'), remote.indexOf('\n}', remote.indexOf('REASON_TO_CODE')))
const codeOf = (reason: string) => table.match(new RegExp(`${reason}:\\s*'([a-z-]+)'`))?.[1]

describe('коды отказа гейта записи', () => {
  it('обе причины ядра разбираются', () => {
    expect(codeOf('GATE_UNAVAILABLE'), 'связь сорвалась').toBeTruthy()
    expect(codeOf('GATE_MALFORMED'), 'ответ не разобран').toBeTruthy()
  })

  it('дают разные коды порта — иначе разведение ничего не меняет', () => {
    expect(codeOf('GATE_UNAVAILABLE')).not.toBe(codeOf('GATE_MALFORMED'))
    expect(codeOf('GATE_MALFORMED')).not.toBe('internal')
  })

  it('у каждого свой текст, и тексты не совпадают', () => {
    for (const dict of [ru, en]) {
      const a = dict.match(/'branch\.errGateUnavailable': '([^']+)'/)?.[1]
      const b = dict.match(/'branch\.errGateMalformed': '([^']+)'/)?.[1]
      expect(a, 'текст «связь сорвалась»').toBeTruthy()
      expect(b, 'текст «ответ не разобран»').toBeTruthy()
      expect(a).not.toBe(b)
    }
  })
})
