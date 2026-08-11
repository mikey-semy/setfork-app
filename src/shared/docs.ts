import type { Lang } from '@/shared/i18n'
import { ABOUT_URL, DOCS_ORIGIN } from '@/shared/site'

// Документация — отдельный сайт (репо setfork-docs). Сам адрес и его дефолт живут
// в `shared/site.ts`: здесь только сборка ссылок по языку и разделам.
export const DOCS_URL = DOCS_ORIGIN

/**
 * Ссылка на страницу доков с учётом языка. В доках язык по умолчанию —
 * РУССКИЙ (без префикса), английский живёт под /en (setfork-docs, db6eb7d).
 */
export function docsUrl(path: string, lang: Lang): string {
  return `${DOCS_URL}${lang === 'en' ? '/en' : ''}${path}`
}

/** Ссылка на лендинг «О проекте» (проект setfork-about, по ПУТИ канона — SEO).
 *  Одна на подвал сайта и на подвал писем; адрес — из `shared/site.ts`. */
export function aboutUrl(): string {
  return ABOUT_URL
}

export type LegalPage = 'terms' | 'privacy' | 'copyright' | 'acceptable-use'

/** Ссылка на юридическую страницу доков на языке пользователя. */
export function legalUrl(page: LegalPage, lang: Lang): string {
  return docsUrl(`/docs/legal/${page}`, lang)
}
