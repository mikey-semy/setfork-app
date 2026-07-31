'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { setFeedbackStatus } from './actions'
import type { FeedbackFilter, FeedbackItem } from './queries'

const CAT_LABEL = {
  bug: 'fbCatBug',
  idea: 'fbCatIdea',
  content: 'fbCatContent',
  legal: 'fbCatLegal',
  other: 'fbCatOther',
} as const

function StatusBadge({ status, lang }: { status: FeedbackItem['status']; lang: Lang }) {
  const cls =
    status === 'new'
      ? 'bg-accent/10 text-accent'
      : status === 'seen'
        ? 'bg-warn/10 text-ink-2'
        : 'bg-surface-2 text-muted'
  const label = status === 'new' ? 'fbStatusNew' : status === 'seen' ? 'fbStatusSeen' : 'fbStatusDone'
  return <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${cls}`}>{t(label, lang)}</span>
}

function Row({ item, lang }: { item: FeedbackItem; lang: Lang }) {
  const [pending, start] = useTransition()
  const setStatus = (status: FeedbackItem['status']) => start(async () => setFeedbackStatus(item.id, status))
  const btn =
    'rounded-md border border-border bg-surface px-2.5 py-1 text-[0.78125rem] font-semibold text-ink-2 hover:border-border-strong hover:text-ink disabled:opacity-50'

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.78125rem] text-ink-2">
        <StatusBadge status={item.status} lang={lang} />
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-2">
          {t(CAT_LABEL[item.category], lang)}
        </span>
        {item.handle ? (
          <Link href={`/${item.handle}`} className="font-semibold text-ink hover:underline">
            {item.handle}
          </Link>
        ) : (
          <span className="text-muted">{t('fbAnon', lang)}</span>
        )}
        {item.email && <span className="text-muted">{item.email}</span>}
        <span className="ml-auto text-muted">{new Date(item.createdAt).toLocaleString()}</span>
      </div>
      <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ink">{item.body}</p>
      {item.pageUrl && <p className="mt-2 break-all text-[0.6875rem] text-muted">{item.pageUrl}</p>}
      <div className="mt-3 flex gap-2">
        {item.status !== 'seen' && (
          <button type="button" disabled={pending} onClick={() => setStatus('seen')} className={btn}>
            {t('fbStatusSeen', lang)}
          </button>
        )}
        {item.status !== 'done' && (
          <button type="button" disabled={pending} onClick={() => setStatus('done')} className={btn}>
            {t('fbStatusDone', lang)}
          </button>
        )}
        {item.status !== 'new' && (
          <button type="button" disabled={pending} onClick={() => setStatus('new')} className={btn}>
            {t('fbStatusNew', lang)}
          </button>
        )}
      </div>
    </div>
  )
}

export function FeedbackTable({
  items,
  counts,
  filter,
  lang,
}: {
  items: FeedbackItem[]
  counts: Record<FeedbackFilter, number>
  filter: FeedbackFilter
  lang: Lang
}) {
  const tabs: { key: FeedbackFilter; label: string }[] = [
    { key: 'all', label: t('fbAll', lang) },
    { key: 'new', label: t('fbStatusNew', lang) },
    { key: 'seen', label: t('fbStatusSeen', lang) },
    { key: 'done', label: t('fbStatusDone', lang) },
  ]
  return (
    <div>
      <div className="mb-4 flex gap-1.5">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === 'all' ? '/admin/feedback' : `/admin/feedback?filter=${tab.key}`}
            className={`rounded-md px-3 py-1.5 text-[0.78125rem] font-semibold ${
              filter === tab.key ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {tab.label} <span className="opacity-70">{counts[tab.key]}</span>
          </Link>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState variant="plain" hint={t('fbEmpty', lang)} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Row key={item.id} item={item} lang={lang} />
          ))}
        </div>
      )}
    </div>
  )
}
