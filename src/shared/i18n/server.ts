import { cookies } from 'next/headers'
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from './index'

/** Текущий язык из cookie (server components / actions). */
export async function getLang(): Promise<Lang> {
  const c = await cookies()
  const v = c.get(LANG_COOKIE)?.value
  return isLang(v) ? v : DEFAULT_LANG
}
