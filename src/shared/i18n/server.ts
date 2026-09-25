import { cookies, headers } from 'next/headers'
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from './index'
import { preferredLang } from './negotiate'
import { pageSourceLang } from './page-source-lang'
import { REQUEST_PATH_HEADER } from '@/shared/request-path'

/**
 * Текущий язык интерфейса: cookie `lang` (ставит LangSwitch в шапке) →
 * Accept-Language браузера → язык списка, на странице которого мы, → en. Включено при
 * развороте на РФ (ADR-0008): словарь UI полный (en/ru), контент — locale-JSON, так что
 * язык — это только выбор ключа. Хост-зависимый дефолт (setfork.ru → ru) — Ф-RU1.
 *
 * Разбор заголовка — общий (`preferredLang`): у интерфейса и у git-транспорта
 * различаются только источники приоритета (cookie против профиля), а правила чтения
 * `Accept-Language` обязаны быть одни. Две копии уже разошлись и обе теряли веса `q`.
 *
 * ⚠️ Язык списка — ТОЛЬКО когда зритель не назвал никакого: ни куки, ни знакомого языка в
 * `Accept-Language`. Так приходит робот поисковика; человек, приславший `en`, получает `en`.
 * Языка в адресе нет (ADR-0029), и без этого шага русский список робот видел бы английской
 * страницей (ADR-0030).
 */
export async function getLang(): Promise<Lang> {
  const c = await cookies()
  const fromCookie = c.get(LANG_COOKIE)?.value
  if (isLang(fromCookie)) return fromCookie
  const h = await headers()
  const asked = preferredLang(h.get('accept-language'))
  if (asked) return asked
  const source = await pageSourceLang(h.get(REQUEST_PATH_HEADER))
  return isLang(source) ? source : DEFAULT_LANG
}
