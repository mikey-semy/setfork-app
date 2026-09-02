'use client'
import { useEffect, useState } from 'react'
import type { LocaleText } from '@/shared/i18n'
// Роуты, чей первый сегмент — НЕ handle пользователя: общий список под тестом-синхроном
// с src/app (разъезд давал «SF guilds»).
import { RESERVED_TOP } from '@/shared/nav/reserved-top'
import { LIST_VISIBILITY_BADGE, type ListVisibilityState } from '@/shared/list-visibility'

export interface Crumb {
  handle: string
  /** undefined на профиле: там второго сегмента нет. */
  slug?: string
}

/** Состояние списка в крамбе: null — роут ещё не ответил, и значка быть не должно. */
export type CrumbVisibility = ListVisibilityState | null

/** Значение из сети доверия не заслуживает: сверяем его с известными состояниями. */
function parseVisibility(v: unknown): CrumbVisibility {
  return typeof v === 'string' && Object.hasOwn(LIST_VISIBILITY_BADGE, v) ? (v as ListVisibilityState) : null
}

/**
 * Бредкрамб шапки (как owner/repo у GitHub): чей профиль или список открыт.
 *
 * Название и видимость приходится ДОСТАВАТЬ: путь знает только slug. Пока ответа нет,
 * показывается slug (мгновенный фолбэк), а видимость остаётся null — булев флаг здесь
 * врал бы, потому что false означало бы сразу и «публичный», и «ещё не знаем», а значок
 * глобуса на приватном списке — худшая из возможных подписей.
 */
export function useCrumb(pathname: string): { crumb: Crumb | null; title: LocaleText | null; visibility: CrumbVisibility; isListPage: boolean } {
  const crumb = parseCrumb(pathname)
  const [title, setTitle] = useState<LocaleText | null>(null)
  const [visibility, setVisibility] = useState<CrumbVisibility>(null)
  const handle = crumb?.handle
  const slug = crumb?.slug

  useEffect(() => {
    if (!handle || !slug) {
      setTitle(null)
      setVisibility(null)
      return
    }
    let alive = true
    setTitle(null)
    setVisibility(null)
    fetch(`/api/list-title?h=${encodeURIComponent(handle)}&s=${encodeURIComponent(slug)}`)
      // Ошибку не разбираем как ответ: тело ошибки — не название списка.
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { title?: LocaleText | null; visibility?: unknown } | null) => {
        if (!alive || !d) return
        setTitle(d.title ?? null)
        setVisibility(parseVisibility(d.visibility))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [handle, slug])

  return {
    crumb,
    title,
    visibility,
    // Страница списка = /handle/slug/*. На /handle/catalogs/* второй сегмент — литерал
    // «catalogs», и переключатель показывал бы фейковый «текущий» список (авто-ревью #589).
    isListPage: crumb?.slug != null && crumb.slug !== 'catalogs',
  }
}

/** Первый сегмент — handle, если это не зарезервированный роут; второй — slug списка. */
function parseCrumb(pathname: string): Crumb | null {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 0 || RESERVED_TOP.has(segs[0])) return null
  return { handle: segs[0], slug: segs[1] }
}
