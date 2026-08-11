/**
 * Операции над текстом в поле ввода: обернуть выделение, дописать префикс к строкам,
 * вставить, сдвинуть отступ. ЧИСТЫЕ функции «текст + выделение → текст + выделение»:
 * ни DOM, ни React, ни языка — поэтому их можно проверить тестами без браузера.
 *
 * Один набор на оба редактора (MarkdownEditor и BubbleTextEditor): раньше `surround` и
 * `linePrefix` были в них скопированы строка в строку, при уже общих тулбаре, списке
 * упоминаний и расчёте каретки.
 */

/** Текст после операции и куда встанет выделение. */
export interface TextEdit {
  text: string
  selStart: number
  selEnd: number
}

/** Отступ в markdown — два пробела (так же снимается Shift+Tab). */
const INDENT = '  '

/**
 * Обернуть выделение парой (**жирный**, _курсив_, [ссылка](url)). Пустое выделение
 * заменяется подсказкой-плейсхолдером и остаётся выделенным — чтобы сразу набрать своё.
 */
export function surroundText(value: string, start: number, end: number, before: string, after: string, placeholder = ''): TextEdit {
  const selected = value.slice(start, end) || placeholder
  return {
    text: value.slice(0, start) + before + selected + after + value.slice(end),
    selStart: start + before.length,
    selEnd: start + before.length + selected.length,
  }
}

/**
 * Дописать префикс каждой строке выделения (цитата, списки, нумерация). Строка, где
 * стоит каретка, берётся целиком — от начала строки, а не от каретки.
 */
export function prefixLines(value: string, start: number, end: number, make: (i: number) => string): TextEdit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const block = value.slice(lineStart, end)
  const replaced = block
    .split('\n')
    .map((l, i) => make(i) + l)
    .join('\n')
  return { text: value.slice(0, lineStart) + replaced + value.slice(end), selStart: lineStart, selEnd: lineStart + replaced.length }
}

/** Вставить текст вместо выделения; каретка встаёт после вставленного. */
export function insertText(value: string, start: number, end: number, text: string): TextEdit {
  const caret = start + text.length
  return { text: value.slice(0, start) + text + value.slice(end), selStart: caret, selEnd: caret }
}

/**
 * Tab и Shift+Tab. Без выделения Tab — это просто отступ в позиции каретки (иначе
 * набор текста прерывался бы сдвигом всей строки); с выделением сдвигается блок целиком.
 */
export function indentLines(value: string, start: number, end: number, back: boolean): TextEdit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  if (back) {
    const block = value.slice(lineStart, end)
    const dedented = block.replace(new RegExp(`^ {1,${INDENT.length}}`, 'gm'), '')
    return {
      text: value.slice(0, lineStart) + dedented + value.slice(end),
      selStart: Math.max(lineStart, start - INDENT.length),
      selEnd: end - (block.length - dedented.length),
    }
  }
  if (start === end) return insertText(value, start, end, INDENT)
  const block = value.slice(lineStart, end)
  const indented = block.replace(/^/gm, INDENT)
  return {
    text: value.slice(0, lineStart) + indented + value.slice(end),
    selStart: start + INDENT.length,
    selEnd: end + (indented.length - block.length),
  }
}
