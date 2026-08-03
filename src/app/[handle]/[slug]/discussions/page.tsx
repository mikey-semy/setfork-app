import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MessageSquare, Plus } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { timeAgo } from '@/shared/ui/timeAgo'
import { Tooltip } from '@/shared/ui/Tooltip'
import { requireViewableMeta } from '@/features/library/guard'
import { getDiscussions } from '@/features/discussions/queries'
import { DISCUSSION_CATEGORIES, categoryLabel, categoryMeta } from '@/features/discussions/constants'
import { PAGE } from '@/shared/ui/control'
import { isFeatureEnabled } from '@/core'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('featDiscussions', lang)} · ${handle}/${slug}` }
}

export default async function DiscussionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ category?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  // Тот же предикат, что у записи (canWriteToFeature): страница отражает решение
  // владельца, но не заменяет его — проверка живёт в actions.
  if (!isFeatureEnabled(meta, 'discussions')) notFound() // раздел выключен (Settings → Features)

  const category = sp.category && DISCUSSION_CATEGORIES.some((c) => c.key === sp.category) ? sp.category : undefined
  const list = await getDiscussions(meta.id, { category })
  const base = `/${owner}/${slug}/discussions`

  return (
    <>
      <div className={PAGE}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Link href={base} className={`rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium ${!category ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}>
              {ru ? 'Все' : 'All'}
            </Link>
            {DISCUSSION_CATEGORIES.map((c) => (
              <Link
                key={c.key}
                href={`${base}?category=${c.key}`}
                className={`rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium ${category === c.key ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {c.icon} {ru ? c.ru : c.en}
              </Link>
            ))}
          </div>
          {session && (
            <Link href={`${base}/new`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[0.8125rem] font-semibold text-primary-fg">
              <Plus size={15} /> {ru ? 'Новое обсуждение' : 'New discussion'}
            </Link>
          )}
        </div>

        {list.length === 0 ? (
          <EmptyState hint={ru ? 'Обсуждений пока нет.' : 'No discussions yet.'} />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {list.map((d) => (
              <div key={d.id} className="flex items-start gap-3 px-4 py-3">
                <Tooltip label={categoryLabel(d.category, lang)}>
                  <span className="mt-0.5 text-[1rem]">{categoryMeta(d.category).icon}</span>
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/${d.number}`} className="min-w-0 text-[0.875rem] font-semibold text-ink hover:text-accent [overflow-wrap:anywhere]">
                    {d.title}
                  </Link>
                  <div className="mt-0.5 text-[0.78125rem] text-muted">
                    #{d.number} · {d.authorHandle} · {timeAgo(d.createdAt, lang)}
                  </div>
                </div>
                {d.commentCount > 0 && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[0.78125rem] text-muted">
                    <MessageSquare size={13} /> {d.commentCount}
                  </span>
                )}
                <Avatar handle={d.authorHandle} avatarUrl={d.authorAvatarUrl} size={20} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
