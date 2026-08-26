import Link from 'next/link'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ListHealth } from './health'
import { cardClass } from '@/shared/ui/card-style'

/**
 * Панель здоровья списков (HQ §11): светофор «где болит прямо сейчас».
 * red — требует внимания (открытые предложения/issues, ссылки ведут прямо в них),
 * yellow — свежая активность за неделю, green — спокойно. Server component.
 */
const DOT: Record<ListHealth['status'], string> = {
  red: 'bg-danger',
  yellow: 'bg-warn',
  green: 'bg-ok',
}

export function HealthBoard({ items, lang, ownerHandle }: { items: ListHealth[]; lang: Lang; ownerHandle: string }) {
  if (items.length === 0) return null
  const attention = items.filter((i) => i.status !== 'green')

  return (
    <div className={cardClass({ className: 'mb-5' })}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-body-sm font-semibold uppercase tracking-wide text-muted">{t('library.listHealth', lang)}</span>
        <span className="text-caption text-muted">
          {attention.length === 0
            ? t('library.allCalm', lang)
            : t('library.needALookN', lang).replace('{n}', String(attention.length))}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.slice(0, 8).map((it) => {
          const title = tr(it.title as LocaleText, lang) || it.slug
          const notes: string[] = []
          if (it.openSuggestions) notes.push(t('library.suggestionsN', lang).replace('{n}', String(it.openSuggestions)))
          if (it.openIssues) notes.push(t('library.issuesN', lang).replace('{n}', String(it.openIssues)))
          if (it.freshStars) notes.push(`★ +${it.freshStars}`)
          if (it.freshForks) notes.push(t('library.forksPlusN', lang).replace('{n}', String(it.freshForks)))
          if (it.freshDiscussions) notes.push(t('library.talksPlusN', lang).replace('{n}', String(it.freshDiscussions)))
          // Красный ведёт ПРЯМО в боль: сначала предложения, потом issues.
          const base = `/${ownerHandle}/${it.slug}`
          const href = it.status === 'red' ? (it.openSuggestions ? `${base}/suggestions` : `${base}/issues`) : base
          return (
            <li key={it.id} className="flex items-baseline gap-2 text-body">
              <span className={`mt-0.5 size-2 shrink-0 self-center rounded-full ${DOT[it.status]}`} aria-hidden />
              <Link href={href} className="min-w-0 flex-1 truncate font-medium text-ink hover:text-accent">
                {title}
              </Link>
              {notes.length > 0 && <span className="shrink-0 text-caption text-muted">{notes.join(' · ')}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
