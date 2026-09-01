import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walkSrc, relSrc } from '../helpers/walk-src'

/**
 * ТОЧКА-ПОДСКАЗКА РИСУЕТСЯ ОДНИМ ПРИМИТИВОМ.
 *
 * Кружок «здесь есть что-то новое» писали руками, и копий стало три: в кнопке «Ещё
 * действия», в кирке разбора и в пунктах меню. Каждая задавала размер, цвет и положение
 * заново — а размер тут не украшение: крупная точка читается как грязь на экране, мелкая
 * спорит с иконкой. Одинаковыми они были только пока их писал один человек в один день.
 *
 * Признак нарушения — круглый кружок размером со ступень подсказки мимо `HintDot`.
 */
const ALLOWED = new Set(['src/shared/ui/HintDot.tsx'])
/** `size-1.5 … rounded-full` в любом порядке: это и есть рукописная точка. */
const HANDMADE = /size-1\.5[^"'`]*rounded-full|rounded-full[^"'`]*size-1\.5/

describe('точка-подсказка рисуется одним примитивом', () => {
  it('рукописных кружков вне HintDot нет', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!file.endsWith('.tsx')) continue
      const rel = relSrc(file)
      if (ALLOWED.has(rel)) continue
      for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        const t = line.trimStart()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
        if (HANDMADE.test(line)) offenders.push(`${rel}:${i + 1}`)
      }
    }
    expect(offenders, 'точку рисует HintDot — иначе копии разъедутся размером и цветом').toEqual([])
  })

  it('проверке есть что проверять', () => {
    // Анти-вырождение: и список исключений, и сам примитив могли исчезнуть, оставив
    // проверку зелёной на пустом месте.
    const files = walkSrc(new URL('../../src', import.meta.url).pathname).filter((f) => f.endsWith('.tsx'))
    expect(files.length, 'исходников не найдено — проверка выше проверяет пустоту').toBeGreaterThan(100)
    expect(
      files.filter((f) => HANDMADE.test(readFileSync(f, 'utf8'))).map(relSrc),
      'примитив обязан содержать ту самую разметку, иначе правило ищет несуществующее',
    ).toEqual([...ALLOWED])
  })
})
