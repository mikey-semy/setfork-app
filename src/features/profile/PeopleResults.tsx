import Link from 'next/link'
import { ListChecks, Users } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { t, type Lang } from '@/shared/i18n'
import type { PersonRow } from './search'

/** Выдача людей (scope=people) — карточки в стиле GitHub Users. */
export function PeopleResults({ people, lang }: { people: PersonRow[]; lang: Lang }) {
  return (
    <ul className="space-y-3 py-3">
      {people.map((p) => (
        <li key={p.handle}>
          <Link
            href={`/${p.handle}`}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong"
          >
            <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                {p.name && <span className="truncate text-[0.875rem] font-semibold text-ink">{p.name}</span>}
                <span className="truncate text-[0.8125rem] text-ink-2">@{p.handle}</span>
              </div>
              {p.bio && <p className="mt-0.5 line-clamp-2 text-[0.8125rem] text-ink-2">{p.bio}</p>}
              <div className="mt-1.5 flex items-center gap-4 text-[0.78125rem] text-muted">
                <span className="inline-flex items-center gap-1">
                  <ListChecks size={13} /> {p.listsCount} {t('listsLabel', lang)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users size={13} /> {p.followersCount} {t('followersLabel', lang)}
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
