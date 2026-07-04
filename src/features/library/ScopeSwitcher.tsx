import Link from 'next/link'
import { CircleDot, ListChecks, Users } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

export type Scope = 'lists' | 'people' | 'issues'

/**
 * Верхнеуровневый переключатель типа сущности (как Repositories/Issues/Users на
 * GitHub). Свободный текст `q` переносится между scope'ами; list-специфичные
 * параметры (sort) — только у Lists.
 */
export function ScopeSwitcher({
  active,
  counts,
  q,
  sort,
  lang,
  basePath = '/search',
  orientation = 'vertical',
}: {
  active: Scope
  counts: { lists: number; people: number; issues: number }
  q?: string
  sort?: string
  lang: Lang
  basePath?: string
  orientation?: 'vertical' | 'horizontal'
}) {
  const href = (scope: Scope) => {
    const p = new URLSearchParams()
    if (scope !== 'lists') p.set('scope', scope)
    if (q) p.set('q', q)
    if (scope === 'lists' && sort) p.set('sort', sort)
    const s = p.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  const items: { scope: Scope; label: string; icon: typeof Users; count: number }[] = [
    { scope: 'lists', label: t('scopeLists', lang), icon: ListChecks, count: counts.lists },
    { scope: 'people', label: t('people', lang), icon: Users, count: counts.people },
    { scope: 'issues', label: t('scopeIssues', lang), icon: CircleDot, count: counts.issues },
  ]

  if (orientation === 'horizontal') {
    // Мобильный ряд-пилюли (сайдбар скрыт на узких экранах).
    const pill = (on: boolean) =>
      `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${
        on ? 'border-border-strong bg-surface font-semibold text-ink' : 'border-border text-ink-2 hover:text-ink'
      }`
    return (
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((it) => (
          <Link key={it.scope} href={href(it.scope)} className={pill(active === it.scope)}>
            <it.icon size={13} className="shrink-0 text-muted" />
            {it.label}
            <span className="font-mono text-[11px] text-muted">{it.count}</span>
          </Link>
        ))}
      </div>
    )
  }

  const row = (on: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
      on ? 'bg-surface font-semibold text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'
    }`

  return (
    <div className="mb-4 flex flex-col gap-0.5">
      {items.map((it) => (
        <Link key={it.scope} href={href(it.scope)} className={row(active === it.scope)}>
          <it.icon size={14} className="shrink-0 text-muted" />
          {it.label}
          <span className="ml-auto rounded-full bg-surface px-1.5 font-mono text-[11px] text-muted">{it.count}</span>
        </Link>
      ))}
    </div>
  )
}
