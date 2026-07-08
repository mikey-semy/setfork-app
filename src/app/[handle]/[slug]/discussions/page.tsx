import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MessageSquare, Plus } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { Avatar } from '@/shared/ui/Avatar'
import { timeAgo } from '@/shared/ui/timeAgo'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import { getDiscussions } from '@/features/discussions/queries'
import { DISCUSSION_CATEGORIES, categoryLabel, categoryMeta } from '@/features/discussions/constants'

export default async function DiscussionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ category?: string }>
}) {
  const { handle: owner, slug } = await params
  const sp = await searchParams
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  const category = sp.category && DISCUSSION_CATEGORIES.some((c) => c.key === sp.category) ? sp.category : undefined
  const list = await getDiscussions(meta.id, { category })
  const base = `/${owner}/${slug}/discussions`

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="discussions" />
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Link href={base} className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${!category ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}>
              {ru ? 'Все' : 'All'}
            </Link>
            {DISCUSSION_CATEGORIES.map((c) => (
              <Link
                key={c.key}
                href={`${base}?category=${c.key}`}
                className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${category === c.key ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {c.icon} {ru ? c.ru : c.en}
              </Link>
            ))}
          </div>
          {session && (
            <Link href={`${base}/new`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
              <Plus size={15} /> {ru ? 'Новое обсуждение' : 'New discussion'}
            </Link>
          )}
        </div>

        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {ru ? 'Обсуждений пока нет.' : 'No discussions yet.'}
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {list.map((d) => (
              <div key={d.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 text-[16px]" title={categoryLabel(d.category, lang)}>
                  {categoryMeta(d.category).icon}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/${d.number}`} className="text-[14.5px] font-semibold text-ink hover:text-accent">
                    {d.title}
                  </Link>
                  <div className="mt-0.5 text-[12px] text-muted">
                    #{d.number} · {d.authorHandle} · {timeAgo(d.createdAt, lang)}
                  </div>
                </div>
                {d.commentCount > 0 && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
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
