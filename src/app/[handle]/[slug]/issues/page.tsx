import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CircleDot, CircleCheck, MessageSquare, Plus } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { getListMeta } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'
import { getIssueCounts, getIssues, type IssueFilter } from '@/features/issues/queries'
import { IssueLabelChips } from '@/features/issues/IssueLabelChips'

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { handle: owner, slug } = await params
  const sp = await searchParams
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()

  const status: IssueFilter = sp.status === 'closed' ? 'closed' : 'open'
  const [counts, list] = await Promise.all([getIssueCounts(meta.id), getIssues(meta.id, status)])
  const base = `/${owner}/${slug}/issues`
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { day: 'numeric', month: 'short' })

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="issues" />
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-[13.5px] font-semibold">
            <Link href={`${base}?status=open`} className={`inline-flex items-center gap-1.5 ${status === 'open' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <CircleDot size={15} /> {counts.open} {t('openLabel', lang)}
            </Link>
            <Link href={`${base}?status=closed`} className={`inline-flex items-center gap-1.5 ${status === 'closed' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <CircleCheck size={15} /> {counts.closed} {t('closedLabel', lang)}
            </Link>
          </div>
          {session && (
            <Link href={`${base}/new`} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-fg">
              <Plus size={15} /> {t('newIssue', lang)}
            </Link>
          )}
        </div>

        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {status === 'open' ? t('noOpenIssues', lang) : t('noClosedIssues', lang)}
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {list.map((it) => (
              <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                {it.status === 'open' ? (
                  <CircleDot size={16} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <CircleCheck size={16} className="mt-0.5 shrink-0 text-accent" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${base}/${it.number}`} className="text-[14.5px] font-semibold text-ink hover:text-accent">
                      {it.title}
                    </Link>
                    <IssueLabelChips labels={it.labels} lang={lang} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    #{it.number} · {t('openedThis', lang)} {it.authorHandle} · {fmt.format(new Date(it.createdAt))}
                  </div>
                </div>
                {it.commentCount > 0 && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
                    <MessageSquare size={13} /> {it.commentCount}
                  </span>
                )}
                <Avatar handle={it.authorHandle} avatarUrl={it.authorAvatarUrl} size={20} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
