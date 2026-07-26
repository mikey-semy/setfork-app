/**
 * Где выделенная пользователем цитата лежит в ИСХОДНОМ тексте поля.
 *
 * Зачем вообще искать: описание блока рендерится Markdown'ом, поэтому смещения
 * из DOM-выделения не совпадают со смещениями в исходной строке — а пере-привязка
 * работает именно по исходнику. Плюс координатам клиента нельзя доверять.
 * Поэтому клиент присылает ТЕКСТ, а место находим здесь.
 *
 * Не нашли — возвращаем пустой диапазон: тред станет комментарием к блоку
 * целиком. Это честнее, чем привязать наугад.
 */
export function locateQuote(source: string, quote: string): { start: number; end: number } {
  const q = quote.trim()
  if (!q || !source) return { start: 0, end: 0 }

  const exact = source.indexOf(q)
  if (exact >= 0) return { start: exact, end: exact + q.length }

  // Выделение из DOM приходит со схлопнутыми пробелами и без markdown-разметки
  // («**жирный**» в DOM — просто «жирный»). Цепляемся за первое и последнее слово:
  // это переживает и мягкие переносы, и съеденные звёздочки внутри цитаты.
  const words = q.split(/\s+/).filter(Boolean)
  if (!words.length) return { start: 0, end: 0 }
  const from = source.indexOf(words[0])
  if (from < 0) return { start: 0, end: 0 }
  const last = words[words.length - 1]
  const to = source.indexOf(last, from)
  if (to < 0) return { start: from, end: from + words[0].length }
  return { start: from, end: to + last.length }
}
