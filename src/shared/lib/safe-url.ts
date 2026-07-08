// Санитайзер href для ПОЛЬЗОВАТЕЛЬСКИХ URL, выводимых сырым <a href> (ref-ссылки шага,
// video/file-блоки и т.п.). React НЕ нейтрализует javascript:/data: в href на проде —
// на клике они исполняются. Разрешаем http/https/mailto/tel и относительные ссылки
// (/uploads/…, #anchor); остальные схемы (javascript:, data:, vbscript:, file: …) → ''.
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])
// Управляющие символы (в т.ч. TAB/LF/CR), которыми маскируют схему: браузер их
// выкидывает при парсинге, так что "java\tscript:" исполняется как "javascript:".
// Собираем через RegExp-строку, чтобы в исходнике не было литеральных control-байтов.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

export function safeHref(raw: string | null | undefined): string {
  const u = (raw ?? '').replace(CONTROL_CHARS, '').trim()
  if (!u) return ''
  const scheme = u.match(/^([a-z][a-z0-9+.-]*):/i)
  if (scheme) return SAFE_SCHEMES.has(scheme[1].toLowerCase()) ? u : ''
  return u // относительная / якорь / без схемы — безопасно
}
