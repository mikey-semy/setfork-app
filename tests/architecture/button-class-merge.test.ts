import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walkSrc, relSrc } from '../helpers/walk-src'

/**
 * ЦВЕТ КНОПКИ ЗАДАЁТ ВАРИАНТ, А НЕ ДОПИСАННАЯ СТРОКА.
 *
 * `buttonClass()` внутри себя сливает классы через tailwind-merge: переданный
 * `className` побеждает вариант предсказуемо. Но если результат ВКЛЕИТЬ в шаблонную
 * строку и дописать классы снаружи — слияния не происходит, у элемента остаются оба
 * набора, и кто победит, решает порядок правил в собранном CSS.
 *
 * Так пропала подпись на кнопке «Закрыть сайт на обслуживание»: поверх варианта по
 * умолчанию (`bg-surface-2 text-ink`) дописали `bg-danger text-white`, и вышло белым
 * по белому — снимок владельца 02.09.2026. Проверка стережёт способ, а не конкретную
 * кнопку: цвет и фон снаружи запрещены, для них есть `variant`.
 */
const CALL = /\$\{buttonClass\(/
/** Классы, которые спорят с вариантом: заливка, цвет текста, рамка. */
const PAINT = /\b(bg-|text-(?!body|caption|title|left|right|center|nowrap)|border-(?!0\b))/

describe('классы кнопки не дописываются строкой', () => {
  it('после ${buttonClass(...)} в шаблоне нет своих цветов и фонов', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!file.endsWith('.tsx')) continue
      // ⚠️ Комментарии ГАСИМ, сохраняя длину и переводы строк: если вырезать их
      // насовсем, смещения съезжают и правило показывает чужие номера строк —
      // поймано на первом же прогоне.
      const blank = (m: string) => m.replace(/[^\n]/g, ' ')
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^\s*\/\/.*$/gm, blank)
      for (const m of src.matchAll(new RegExp(CALL, 'g'))) {
        // Хвост шаблонной строки до её конца: именно туда и дописывают лишнее.
        const tail = src.slice(m.index, src.indexOf('`', m.index) + 1)
        if (PAINT.test(tail.replace(/buttonClass\([\s\S]*?\)\}/, ''))) {
          offenders.push(`${relSrc(file)}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
    }
    expect(
      offenders,
      'цвет задаёт variant: дописанные снаружи классы не сливаются и спорят с ним в CSS',
    ).toEqual([])
  })

  it('проверке есть что проверять', () => {
    // Анти-вырождение: если `buttonClass` переименуют, правило будет искать пустоту.
    const files = walkSrc(new URL('../../src', import.meta.url).pathname).filter((f) => f.endsWith('.tsx'))
    const users = files.filter((f) => /\bbuttonClass\(/.test(readFileSync(f, 'utf8')))
    expect(users.length, 'buttonClass нигде не вызывается — правило потеряло предмет').toBeGreaterThan(5)
  })
})
