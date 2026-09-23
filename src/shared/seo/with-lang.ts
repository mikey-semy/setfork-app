import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { isLang } from '@/shared/i18n'
import { LANG_HEADER, langHref } from '@/shared/i18n/url'
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

/**
 * Путь страницы на языке адреса — для разметки в ТЕЛЕ страницы (JSON-LD), которой
 * `withLang` не касается: он правит только метаданные.
 *
 * Без этого разметка списка, открытого по `/ru/…`, описывала бы русский текст шагов
 * адресом без языка — то есть приписывала бы его версии, которую поисковик считает
 * другой страницей (находка авто-ревью к SEO-2).
 */
export async function urlLangPath(path: string): Promise<string> {
  return (await urlLangAt())(path)
}

/**
 * То же для НЕСКОЛЬКИХ путей одной страницы: язык берётся один раз, а наружу — функция.
 * Разметке списка нужны сразу его адрес, адрес автора и крошки, и все они обязаны быть
 * на одном языке — на языке адреса, по которому страницу открыли.
 */
export async function urlLangAt(): Promise<(path: string) => string> {
  const fromPath = (await headers()).get(LANG_HEADER)
  return isLang(fromPath) ? (path) => langHref(path, fromPath) : (path) => path
}
