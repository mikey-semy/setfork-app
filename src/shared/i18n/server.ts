import { cookies, headers } from 'next/headers'
import { isLang, LANG_COOKIE, type Lang } from './index'
import { negotiateLang } from './negotiate'
import { LANG_HEADER } from './url'

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
  const h = await headers()
  // ⚠️ Язык ИЗ АДРЕСА старше куки. `/ru/explore` обязан быть русским даже у человека,
  // выбравшего английский: адрес конкретнее, чем общий выбор, и по нему приходят по
  // ссылке извне. Иначе поисковик, сохранивший русский адрес, получал бы английскую
  // страницу — ровно та беда, ради которой языки и разведены по адресам.
  const fromPath = h.get(LANG_HEADER)
  if (isLang(fromPath)) return fromPath
  const c = await cookies()
  const fromCookie = c.get(LANG_COOKIE)?.value
  if (isLang(fromCookie)) return fromCookie
  return negotiateLang(h.get('accept-language'))
}
