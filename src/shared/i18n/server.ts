import { cookies, headers } from 'next/headers'
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from './index'

/**
 * Текущий язык интерфейса: cookie `lang` (ставит LangSwitch в шапке) →
 * Accept-Language браузера → en. Включено при развороте на РФ (ADR-0008):
 * словарь UI полный (en/ru), контент — locale-JSON, так что язык — это
 * только выбор ключа. Хост-зависимый дефолт (setfork.ru → ru) — Ф-RU1.
 */
export async function getLang(): Promise<Lang> {
  const c = await cookies()
  const fromCookie = c.get(LANG_COOKIE)?.value
  if (isLang(fromCookie)) return fromCookie
  // Accept-Language: 'ru-RU,ru;q=0.9,en;q=0.8' → первый поддерживаемый код.
  const accept = (await headers()).get('accept-language') ?? ''
  for (const part of accept.split(',')) {
    const code = part.split(';')[0].trim().slice(0, 2).toLowerCase()
    if (isLang(code)) return code
  }
  return DEFAULT_LANG
}
