import type { Lang } from '@/shared/i18n'

// Документация — отдельный сайт (репо setfork-docs). Домен задаётся env
// (для стендов), дефолт — канон: `setfork.ru` списан 11.08.2026. На этом дефолте
// висят ссылки на политику и условия, а они обязаны открываться с того домена,
// где работает сервис.
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.setfork.com'

/**
 * Ссылка на страницу доков с учётом языка. В доках язык по умолчанию —
 * РУССКИЙ (без префикса), английский живёт под /en (setfork-docs, db6eb7d).
 */
export function docsUrl(path: string, lang: Lang): string {
  return `${DOCS_URL}${lang === 'en' ? '/en' : ''}${path}`
}

// «О проекте» — отдельный маркетинг-лендинг (проект setfork-about). Живёт по ПУТИ
// /about основного домена (basePath, не поддомен — лучше для SEO). Домен задаётся
// env-переменной; дефолт — канон (`setfork.ru` списан 11.08.2026). Ссылка стоит в
// подвале КАЖДОЙ страницы и, с #748, в подвале каждого письма.
const ABOUT_URL = process.env.NEXT_PUBLIC_ABOUT_URL ?? 'https://setfork.com/about'

/** Ссылка на лендинг «О проекте». Одна на подвал сайта и на подвал писем. */
export function aboutUrl(): string {
  return ABOUT_URL
}

export type LegalPage = 'terms' | 'privacy' | 'copyright' | 'acceptable-use'

/** Ссылка на юридическую страницу доков на языке пользователя. */
export function legalUrl(page: LegalPage, lang: Lang): string {
  return docsUrl(`/docs/legal/${page}`, lang)
}
