import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { isLang } from '@/shared/i18n'
import { LANG_HEADER } from '@/shared/i18n/url'
import { localizeMetadata } from './localize'

/**
 * Метаданные страницы, собранные своими руками, — на язык адреса (см. `localizeMetadata`).
 *
 * Язык берётся ИЗ АДРЕСА (заголовок middleware), а не `getLang()`: кука и
 * `Accept-Language` говорят о человеке, а канон — о странице. Страница без префикса
 * остаётся каноном без префикса при любом языке интерфейса.
 */
export async function withLang(meta: Metadata): Promise<Metadata> {
  const fromPath = (await headers()).get(LANG_HEADER)
  return localizeMetadata(meta, isLang(fromPath) ? fromPath : null)
}
