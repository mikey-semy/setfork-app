// Общий разбор JSX для счётчиков интерфейса (`ui-sizes.mjs`, `ui-parity.mjs`).
//
// Заведён 26.08.2026: второй счётчик собирался переписать обход дерева, регулярку тега
// и вынимание классов заново — то есть повторить ровно ту болезнь, которую эти счётчики
// и меряют. Разбор один, счётчики разные.
//
// Это НЕ парсер TSX, а намеренно грубая регулярка: она видит открывающий тег и его
// атрибуты, пока внутри нет вложенных `{...}` глубже одного уровня. Для замера этого
// достаточно (проверено на 500+ файлах), для правки кода — нет.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SRC = join(ROOT, 'src')

/** Путь от корня репозитория, всегда через `/` — чтобы отчёты совпадали на любой ОС. */
export const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')

/** Все файлы с указанными расширениями под `dir`. */
export function walkFiles(dir, exts = ['.tsx']) {
  const out = []
  ;(function walk(d) {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (exts.some((e) => p.endsWith(e))) out.push(p)
    }
  })(dir)
  return out
}

/**
 * Открывающие теги файла: `{ tag, attrs, index, line }`.
 *
 * Не регулярка, а посимвольный проход. Регулярочный вариант (жил в `ui-sizes.mjs` до
 * 26.08.2026) обрывался на атрибуте со стрелочной функцией — `onClick={() => { … }}`
 * содержит и `>`, и вложенные скобки, — а тег внутри атрибута другого тега
 * (`button={(t) => (<button …>)}`) не видел вовсе. Цена слепоты измерена: замер высот
 * видел 5 объявлений из 19, то есть гейт «нарушений 0» девять из них просто не смотрел.
 * Здесь глубина скобок и кавычки считаются честно; сверка со `grep -c '<button'` даёт
 * 239 против 239.
 */
export function* tags(src) {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue
    const name = /^<([A-Za-z][\w.]*)(?=[\s/>])/.exec(src.slice(i, i + 64))
    if (!name) continue
    let j = i + name[0].length
    let depth = 0
    let quote = null
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote) {
        if (c === quote) quote = null
        else if (c === '\\') j++
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
      else if (c === '<' && depth === 0) { j = -1; break } // не тег, а сравнение
    }
    if (j < 0 || j >= src.length) continue
    yield {
      tag: name[1],
      attrs: src.slice(i + name[0].length, j),
      index: i,
      line: src.slice(0, i).split('\n').length,
    }
    // Дальше идём от СЛЕДУЮЩЕГО символа, а не с конца тега: `button={(t) => (<button …>)}`
    // прячет тег внутри атрибута другого тега, и прыжок за `>` внешнего терял его.
  }
}

/** Содержимое `className`/`class` тега одной строкой (все три способа записи). */
export const classesOf = (attrs) =>
  [...attrs.matchAll(/class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)]
    .map((c) => c[1] ?? c[2] ?? c[3])
    .join(' ')

/** Значение строкового атрибута (`type="text"`), если он записан литералом. */
export const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`))
  return m ? (m[1] ?? m[2]) : null
}

export const hasAttr = (attrs, name) => new RegExp(`(?:^|\\s)${name}=`).test(attrs)

/** Хостовый элемент DOM (`div`), а не компонент (`Button`). */
export const isHost = (tag) => /^[a-z]/.test(tag)

export { readFileSync }
