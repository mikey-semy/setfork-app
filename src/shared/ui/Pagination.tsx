import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

/** Пагинация в стиле GitHub: «‹ Назад · N/M · Вперёд ›». Серверный компонент —
 *  `makeHref(page)` строит ссылку с сохранением текущих query-параметров. */
export function Pagination({
  page,
  totalPages,
  makeHref,
  lang,
}: {
  page: number
  totalPages: number
  makeHref: (page: number) => string
  lang: Lang
}) {
  if (totalPages <= 1) return null
  const ru = lang === 'ru'
  const btn = 'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px]'
  const on = 'border-border text-ink hover:border-border-strong'
  const off = 'border-border/60 text-muted opacity-50 pointer-events-none'

  return (
    <nav className="mt-4 flex items-center justify-center gap-3" aria-label={ru ? 'Постранично' : 'Pagination'}>
      {page > 1 ? (
        <Link href={makeHref(page - 1)} className={`${btn} ${on}`}>
          <ChevronLeft size={14} /> {ru ? 'Назад' : 'Previous'}
        </Link>
      ) : (
        <span className={`${btn} ${off}`} aria-disabled>
          <ChevronLeft size={14} /> {ru ? 'Назад' : 'Previous'}
        </span>
      )}
      <span className="font-mono text-[12px] text-muted">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={makeHref(page + 1)} className={`${btn} ${on}`}>
          {ru ? 'Вперёд' : 'Next'} <ChevronRight size={14} />
        </Link>
      ) : (
        <span className={`${btn} ${off}`} aria-disabled>
          {ru ? 'Вперёд' : 'Next'} <ChevronRight size={14} />
        </span>
      )}
    </nav>
  )
}
