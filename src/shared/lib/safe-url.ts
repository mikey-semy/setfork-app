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

/**
 * Тот же URL, но пригодный для заголовка `Location`.
 *
 * Значения заголовков — ByteString (один байт на символ), поэтому `new Response`
 * бросает TypeError на любом не-ASCII символе в адресе. Ссылка шага на статью с
 * кириллицей в пути роняла исходящий редирект `/api/go` пятисотой — вместо перехода
 * пользователь получал ошибку, а клик не засчитывался.
 *
 * Кодируем ровно как браузер в адресной строке: путь и запрос — процентами, домен —
 * punycode. Уже закодированное не портится (`%20` остаётся `%20`). Разобрать не
 * удалось → пустая строка, и вызывающий отвечает 404, а не падает.
 */
export function redirectLocation(raw: string): string {
  try {
    return new URL(raw).href
  } catch {
    return ''
  }
}
