// Пиксельные координаты каретки в <textarea> через зеркальный div (стандартная техника
// textarea-caret-position). Нужно, чтобы поповер @mention/#ref появлялся ПОД курсором.

const PROPS = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const

export function caretCoords(el: HTMLTextAreaElement, pos: number): { top: number; left: number; height: number } {
  const cs = getComputedStyle(el)
  const div = document.createElement('div')
  const s = div.style
  s.position = 'absolute'
  s.visibility = 'hidden'
  s.whiteSpace = 'pre-wrap'
  s.overflowWrap = 'break-word'
  for (const p of PROPS) s.setProperty(p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), cs.getPropertyValue(p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())))

  div.textContent = el.value.slice(0, pos)
  const span = document.createElement('span')
  span.textContent = el.value.slice(pos) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const top = span.offsetTop
  const left = span.offsetLeft
  document.body.removeChild(div)

  const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
  return { top, left, height }
}
