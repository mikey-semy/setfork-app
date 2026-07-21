import type { Lang } from '@/shared/i18n'

// Документация — отдельный сайт (репо setfork-docs). Домен задаётся env
// (для стендов), дефолт — прод на RU-домене (ADR-0008).
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.setfork.ru'

/**
 * Ссылка на страницу доков с учётом языка. В доках язык по умолчанию —
 * РУССКИЙ (без префикса), английский живёт под /en (setfork-docs, db6eb7d).
 */
export function docsUrl(path: string, lang: Lang): string {
  return `${DOCS_URL}${lang === 'en' ? '/en' : ''}${path}`
}

export type LegalPage = 'terms' | 'privacy' | 'copyright' | 'acceptable-use'

/** Ссылка на юридическую страницу доков на языке пользователя. */
export function legalUrl(page: LegalPage, lang: Lang): string {
  return docsUrl(`/docs/legal/${page}`, lang)
}
