import Link from 'next/link'
import { ListChecks, Users } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { plural, t, type Lang } from '@/shared/i18n'
import type { PersonRow } from './search'
import { cardClass } from '@/shared/ui/card-style'

/** Выдача людей (scope=people) — карточки в стиле GitHub Users. */
export function PeopleResults({ people, lang }: { people: PersonRow[]; lang: Lang }) {
  return (
    <ul className="space-y-3 py-3">
      {people.map((p) => (
        <li key={p.handle}>
          <Link
            href={`/${p.handle}`}
            className={cardClass({ pad: 'sm', className: 'flex items-start gap-3 transition-colors hover:border-border-strong' })}
          >
            <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                {p.name && <span className="truncate text-body-lg font-semibold text-ink">{p.name}</span>}
                <span className="truncate text-body text-ink-2">@{p.handle}</span>
              </div>
              {p.bio && <p className="mt-0.5 line-clamp-2 text-body text-ink-2">{p.bio}</p>}
              <div className="mt-1.5 flex items-center gap-4 text-body-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <ListChecks size={13} /> {p.listsCount} {plural(p.listsCount, 'lists', lang)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users size={13} /> {p.followersCount} {plural(p.followersCount, 'followers', lang)}
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
