import Link from 'next/link'
import { cn } from '@/shared/lib/cn'

// Единый чип тега во ВСЁМ приложении → ведёт на /tags/[slug]. Один вид: карточки,
// индекс тегов, explore. Раньше чипы были копипастой со ссылкой на /search?q=tag:.
export function TagChip({
  slug,
  label,
  count,
  curated,
  href,
  className,
}: {
  slug: string
  label?: string
  count?: number
  curated?: boolean
  /** Куда ведёт чип. По умолчанию — страница тега; но в фасетах поиска клик по тегу
   *  ДОЛЖЕН оставаться поиском (фильтр по `tag:`), а не уводить со страницы. Вид у
   *  роли один, назначение бывает разным — поэтому адрес это проп, а не догма. */
  href?: string
  className?: string
}) {
  return (
    <Link
      href={href ?? `/tags/${encodeURIComponent(slug)}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent hover:underline',
        className,
      )}
    >
      {curated && <span aria-hidden>✓</span>}
      {label || slug}
      {count != null && <span className="font-mono text-caption opacity-70">{count}</span>}
    </Link>
  )
}
