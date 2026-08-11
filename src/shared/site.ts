// Адрес сервиса — ЕДИНСТВЕННОЕ место, где домен написан буквами.
//
// До этого модуля его собирали 19 мест в 8 разных формах, и дефолты расходились:
// часть падала на `https://setfork.com`, часть на `http://localhost:3000`. Так домен
// и протух молча при переезде с `setfork.ru` (линза 08, R12): прод отдавал ссылки на
// списанный хост, потому что «поправили» его не везде. Смена домена обязана быть
// правкой ОДНОЙ переменной, как добавление языка — правкой одного файла словаря.
//
// Модуль изоморфный (без `server-only`): его читают и серверные роуты, и подвал.
// Поэтому здесь только `NEXT_PUBLIC_*` — они вшиваются в бандл при сборке.
// Серверный адрес (`APP_URL`, он же может отличаться от публичного) живёт в
// `shared/auth/app-origin.ts` и берёт дефолт отсюда.

const strip = (url: string) => url.replace(/\/$/, '')

/** Публичный адрес сервиса: схема + хост, без завершающего слэша. */
export const SITE_ORIGIN = strip(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://setfork.com')

/** Хост без схемы — для писем, идентификаторов и мест, где схема не нужна. */
export const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, '')

/** Адрес для локальной разработки. Отдельной константой, потому что дефолт «канон»
 *  в деве заставил бы письма и OAuth-возвраты вести на прод. */
export const DEV_ORIGIN = 'http://localhost:3000'

/** Документация — отдельный сайт (репо setfork-docs), поддомен канона. */
export const DOCS_ORIGIN = strip(process.env.NEXT_PUBLIC_DOCS_URL?.trim() || `https://docs.${SITE_HOST}`)

/** Лендинг «О проекте» (проект setfork-about) — по ПУТИ канона, не поддоменом (SEO). */
export const ABOUT_URL = strip(process.env.NEXT_PUBLIC_ABOUT_URL?.trim() || `${SITE_ORIGIN}/about`)

/** Домен служебных адресов авторов коммитов — по образцу `users.noreply.github.com`. */
export const NOREPLY_DOMAIN = `users.noreply.${SITE_HOST}`

/**
 * Представление наших обходчиков чужим сайтам. Владелец сайта по этой строке должен
 * понять, кто пришёл и куда жаловаться, — поэтому адрес здесь тот же, что у сервиса.
 */
export function botUserAgent(purpose?: string): string {
  return `SetForkBot/1.0 (+${SITE_ORIGIN}${purpose ? `; ${purpose}` : ''})`
}
