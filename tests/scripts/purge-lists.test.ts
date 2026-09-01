import { describe, expect, it } from 'vitest'
import { assertNoStopListed, parseIds } from '../../scripts/purge-lists'

/**
 * ДВЕ ПРОВЕРКИ, КОТОРЫЕ РЕШАЮТ, ЧТО БУДЕТ СТЁРТО НАВСЕГДА.
 *
 * Удаление списков необратимо, поэтому обе стороны входа стерегутся тестом: разбор
 * перечня (мусорная строка не должна молча выпасть) и сверка со стоп-листом (совпадение
 * останавливает операцию ЦЕЛИКОМ). Стоп-лист владельца — списки с ценами, которые
 * читают программно: их потеря сломает живое.
 */
const A = '2a90d025-aa80-46f2-a82d-348d06627223'
const B = '1bd4baae-af27-4b06-954d-ec37a91e9c49'
const C = '875f447d-3e0f-49da-b8b2-0414ba137221'

describe('вход на удаление', () => {
  it('берёт первую колонку и терпит табы, комментарии и пустые строки', () => {
    expect(parseIds(`# перечень\n${A}\t some-slug \t Заголовок\n\n${C}\n`)).toEqual([A, C])
  })

  it('мусорная строка роняет разбор, а не пропускается молча', () => {
    expect(() => parseIds(`${A}\nвсего пара строк\n`)).toThrow(/:2:/)
  })

  it('повтор во входе — тоже отказ: дважды удалять нечего, значит перечень собран неверно', () => {
    expect(() => parseIds(`${A}\n${A}\n`)).toThrow(/повторяются/)
  })

  it('регистр id не создаёт двух разных записей', () => {
    expect(() => parseIds(`${A.toUpperCase()}\n${A}\n`)).toThrow(/повторяются/)
  })
})

describe('стоп-лист', () => {
  it('совпадение останавливает операцию целиком', () => {
    expect(() => assertNoStopListed([C, A], [A, B])).toThrow(/ОТКАЗ.*1 id/s)
  })

  it('называет КАЖДЫЙ найденный id — иначе перечень не пересобрать', () => {
    const e = (() => {
      try {
        assertNoStopListed([A, B, C], [A, B])
        return ''
      } catch (err) {
        return (err as Error).message
      }
    })()
    expect(e).toContain(A)
    expect(e).toContain(B)
  })

  it('без пересечения молчит', () => {
    expect(() => assertNoStopListed([C], [A, B])).not.toThrow()
  })
})
