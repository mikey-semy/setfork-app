import { cookies, headers } from 'next/headers'
import { isLang, LANG_COOKIE, type Lang } from './index'
import { negotiateLang } from './negotiate'

/**
 * Текущий язык интерфейса: cookie `lang` (ставит LangSwitch в шапке) →
 * Accept-Language браузера → en. Включено при развороте на РФ (ADR-0008):
 * словарь UI полный (en/ru), контент — locale-JSON, так что язык — это
 * только выбор ключа. Хост-зависимый дефолт (setfork.ru → ru) — Ф-RU1.
 *
 * Разбор заголовка — общий (`negotiateLang`): у интерфейса и у git-транспорта
 * различаются только источники приоритета (cookie против профиля), а правила чтения
 * `Accept-Language` обязаны быть одни. Две копии уже разошлись и обе теряли веса `q`.
 */
export async function getLang(): Promise<Lang> {
  const c = await cookies()
  const fromCookie = c.get(LANG_COOKIE)?.value
  if (isLang(fromCookie)) return fromCookie
  return negotiateLang((await headers()).get('accept-language'))
}
