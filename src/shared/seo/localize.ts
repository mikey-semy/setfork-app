import type { Metadata } from 'next'
import type { Lang } from '@/shared/i18n'
import { langAlternates, langHref } from '@/shared/i18n/url'

/**
 * МЕТАДАННЫЕ СТРАНИЦЫ — НА ЯЗЫКЕ АДРЕСА, по которому её открыли.
 *
 * С SEO-1 у каждого языка свой адрес (`/ru/miki/list`). Страницы, собиравшие канон
 * сами, мимо `pageMeta`, этого не знали: на `/ru/miki/list` канон указывал на
 * `/miki/list`, а `hreflang` не было вовсе. Для поисковика это значит «русская версия —
 * дубль, индексируй другую», и русские СПИСКИ — главное содержимое, ради которого языки
 * разводили, — в индекс не попадали. Замер прода 23.09.2026: так было у списка, профиля,
 * каталога, тега и подборки.
 *
 * Правило одно на всех: канон и `og:url` — на языке адреса (без префикса — как были),
 * плюс взаимные ссылки на обе версии и `x-default`. Путь канона берётся как есть, вместе
 * с номером страницы листалки и вкладкой: они часть адреса, а не языка.
 */
export function localizeMetadata(meta: Metadata, lang: Lang | null): Metadata {
  const canonical = meta.alternates?.canonical
  if (typeof canonical !== 'string' || !canonical.startsWith('/')) return meta
  const at = (p: string) => (lang ? langHref(p, lang) : p)
  const og = meta.openGraph
  return {
    ...meta,
    alternates: {
      ...meta.alternates,
      canonical: at(canonical),
      languages: { ...langAlternates(canonical).languages, 'x-default': canonical },
    },
    ...(og && typeof og.url === 'string' && og.url.startsWith('/') ? { openGraph: { ...og, url: at(og.url) } } : {}),
  }
}
