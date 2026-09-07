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
 *
 * ⚠️ 07.09.2026 у правила нашлись два слепых пятна — предъявлены ему мутацией, не
 * рассуждением (на живом коде оно и до, и после показывает ноль):
 *
 *   1. ВЛОЖЕННАЯ ПОДСТАНОВКА. Хвост искали до первой обратной кавычки, а она может
 *      ОТКРЫВАТЬ вложенный шаблон внутри `${…}`. Тогда всё, что за ней, обрезалось:
 *      `${buttonClass(…)} ${on ? `bg-danger text-white` : ''}` проходило насквозь —
 *      а это ровно та форма, которой кнопку и красят по условию.
 *   2. ФАЙЛЫ `.ts`. Смотрели только `.tsx`, но строители классов часто лежат
 *      отдельным модулем, и там тот же дефект был не виден вовсе.
 */
const CALL = /\$\{buttonClass\(/
/** Классы, которые спорят с вариантом: заливка, цвет текста, рамка. */
const PAINT = /\b(bg-|text-(?!body|caption|title|left|right|center|nowrap)|border-(?!0\b))/

/**
 * Хвост шаблонной строки ПОСЛЕ `${buttonClass(…)}` и до её закрывающей кавычки —
 * со счётом вложенности: обратная кавычка внутри `${…}` открывает ВЛОЖЕННЫЙ шаблон
 * и строку не закрывает. Наивный поиск первой кавычки обрывался на ней и не видел
 * дописанный дальше цвет.
 */
function tailOfTemplate(src: string, from: number): string {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '$' && src[i + 1] === '{') {
      depth++
      i++
      continue
    }
    if (c === '}' && depth > 0) {
      depth--
      continue
    }
    if (c === '`' && depth === 0) return src.slice(from, i)
  }
  return src.slice(from)
}

describe('классы кнопки не дописываются строкой', () => {
  it('после ${buttonClass(...)} в шаблоне нет своих цветов и фонов', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      // `.ts` тоже: строитель классов, вынесенный из компонента, красит так же.
      if (!/\.tsx?$/.test(file)) continue
      // ⚠️ Комментарии ГАСИМ, сохраняя длину и переводы строк: если вырезать их
      // насовсем, смещения съезжают и правило показывает чужие номера строк —
      // поймано на первом же прогоне.
      const blank = (m: string) => m.replace(/[^\n]/g, ' ')
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^\s*\/\/.*$/gm, blank)
      for (const m of src.matchAll(new RegExp(CALL, 'g'))) {
        const tail = tailOfTemplate(src, m.index)
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

  // ⚠️ Узда на узду. Оба случая ниже правило РАНЬШЕ пропускало, и ноль в его счётчике
  // выглядел как чистота. Это единственное место, где видно, что оно ещё живо.
  it.each([
    ['вложенный шаблон в подстановке', '`${buttonClass({ size: "lg" })} ${on ? `bg-danger` : ""}`'],
    ['цвет дописан прямо', '`${buttonClass({ size: "lg" })} bg-danger text-white`'],
    ['цвет в тернарнике без вложенного шаблона', '`${buttonClass({ size: "lg" })} ${on ? "bg-danger" : ""}`'],
  ])('правило видит дефект: %s', (_name, sample) => {
    const at = sample.search(CALL)
    const tail = tailOfTemplate(sample, at).replace(/buttonClass\([\s\S]*?\)\}/, '')
    expect(PAINT.test(tail), 'образец должен быть найден — иначе правило ослепло').toBe(true)
  })

  it('и не срабатывает там, где цвета нет', () => {
    const ok = '`${buttonClass({ size: "lg" })} w-full ${on ? "opacity-50" : ""}`'
    const at = ok.search(CALL)
    const tail = tailOfTemplate(ok, at).replace(/buttonClass\([\s\S]*?\)\}/, '')
    expect(PAINT.test(tail), 'размер и прозрачность варианту не противоречат').toBe(false)
  })

  it('проверке есть что проверять', () => {
    // Анти-вырождение: если `buttonClass` переименуют, правило будет искать пустоту.
    const files = walkSrc(new URL('../../src', import.meta.url).pathname).filter((f) => /\.tsx?$/.test(f))
    const users = files.filter((f) => /\bbuttonClass\(/.test(readFileSync(f, 'utf8')))
    expect(users.length, 'buttonClass нигде не вызывается — правило потеряло предмет').toBeGreaterThan(5)
  })
})
