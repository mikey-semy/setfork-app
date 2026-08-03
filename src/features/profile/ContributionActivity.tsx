import Link from 'next/link'
import { ChevronLeft, ChevronRight, CircleDot, GitCommitHorizontal, GitPullRequest, Rocket } from 'lucide-react'
import { tr, type Lang } from '@/shared/i18n'
import type { MonthActivity } from './queries'

/** Лента активности за месяц (Contribution activity, как GitHub):
 *  типы работ с иконками — версии, созданные списки, issues, предложения. */
export function ContributionActivity({
  activity,
  monthStart,
  handle,
  lang,
  nav,
}: {
  activity: MonthActivity
  monthStart: Date
  handle: string
  lang: Lang
  nav?: { prev: string | null; next: string | null }
}) {
  const ru = lang === 'ru'
  const month = new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'long', year: 'numeric' }).format(monthStart)
  const navBtn = 'grid h-6 w-6 place-items-center rounded-md border border-border text-muted hover:text-ink'
  const { versions, versionsTotal, listsCreated, issuesOpened, issuesLists, suggestionsCreated } = activity
  const empty = versionsTotal === 0 && listsCreated.length === 0 && issuesOpened === 0 && suggestionsCreated === 0

  return (
    <section className="mt-6">
      <div className="mb-3 text-[1rem] font-semibold text-ink">{ru ? 'Активность' : 'Contribution activity'}</div>
      <div className="mb-4 flex items-center justify-between border-b border-border pb-1">
        <span className="text-[0.78125rem] font-semibold uppercase tracking-wide text-muted">{month}</span>
        {nav && (nav.prev || nav.next) && (
          <span className="flex items-center gap-1">
            {nav.prev ? (
              <Link href={nav.prev} className={navBtn} aria-label={ru ? 'Предыдущий месяц' : 'Previous month'}>
                <ChevronLeft size={13} />
              </Link>
            ) : (
              <span className={`${navBtn} opacity-40`}><ChevronLeft size={13} /></span>
            )}
            {nav.next ? (
              <Link href={nav.next} className={navBtn} aria-label={ru ? 'Следующий месяц' : 'Next month'}>
                <ChevronRight size={13} />
              </Link>
            ) : (
              <span className={`${navBtn} opacity-40`}><ChevronRight size={13} /></span>
            )}
          </span>
        )}
      </div>

      {empty ? (
        <p className="text-[0.8125rem] text-muted">{ru ? 'В этом месяце активности пока нет.' : 'No activity this month yet.'}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {versionsTotal > 0 && (
            <Item icon={<GitCommitHorizontal size={15} />}>
              <div className="text-[0.8125rem] font-medium text-ink">
                {ru ? 'Опубликовано' : 'Created'} <b>{versionsTotal}</b> {ru ? 'версий в' : versionsTotal === 1 ? 'version in' : 'versions in'}{' '}
                <b>{versions.length}</b> {ru ? 'списках' : versions.length === 1 ? 'list' : 'lists'}
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {versions.map((v) => (
                  <li key={v.slug} className="flex items-center justify-between gap-3 text-[0.8125rem]">
                    <Link href={`/${handle}/${v.slug}`} className="truncate text-accent hover:underline">
                      {tr(v.title, lang)}
                    </Link>
                    <span className="shrink-0 font-mono text-[0.6875rem] text-muted">
                      {v.count} {ru ? 'версий' : v.count === 1 ? 'version' : 'versions'}
                    </span>
                  </li>
                ))}
              </ul>
            </Item>
          )}

          {listsCreated.length > 0 && (
            <Item icon={<Rocket size={15} />}>
              <div className="text-[0.8125rem] font-medium text-ink">
                {ru ? 'Создано' : 'Created'} <b>{listsCreated.length}</b> {ru ? 'списков' : listsCreated.length === 1 ? 'list' : 'lists'}
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {listsCreated.slice(0, 5).map((l) => (
                  <li key={l.slug} className="min-w-0">
                    {/* block + truncate, как в блоке версий выше: название списка пишет
                        человек, и одно длинное слово иначе распирает страницу на мобиле
                        (overflow: hidden у truncate заодно снимает автоминимум flex-строки). */}
                    <Link href={`/${handle}/${l.slug}`} className="block truncate text-[0.8125rem] text-accent hover:underline">
                      {tr(l.title, lang)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Item>
          )}

          {issuesOpened > 0 && (
            <Item icon={<CircleDot size={15} />}>
              <div className="text-[0.8125rem] font-medium text-ink">
                {ru ? 'Открыто' : 'Opened'} <b>{issuesOpened}</b> {ru ? 'issue в' : issuesOpened === 1 ? 'issue in' : 'issues in'} <b>{issuesLists}</b>{' '}
                {ru ? 'списках' : issuesLists === 1 ? 'list' : 'lists'}
              </div>
            </Item>
          )}

          {suggestionsCreated > 0 && (
            <Item icon={<GitPullRequest size={15} />}>
              <div className="text-[0.8125rem] font-medium text-ink">
                {ru ? 'Предложено' : 'Proposed'} <b>{suggestionsCreated}</b>{' '}
                {ru ? 'правок (suggestions)' : suggestionsCreated === 1 ? 'suggestion' : 'suggestions'}
              </div>
            </Item>
          )}
        </div>
      )}
    </section>
  )
}

function Item({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
