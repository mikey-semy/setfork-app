'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { setFeedbackStatus } from './actions'
import type { FeedbackFilter, FeedbackItem } from './queries'
import { cardClass } from '@/shared/ui/card-style'
import { Badge } from '@/shared/ui/badge'
import { buttonClass } from '@/shared/ui/button-style'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'

const CAT_LABEL = {
  bug: 'fbCatBug',
  idea: 'fbCatIdea',
  content: 'fbCatContent',
  legal: 'fbCatLegal',
  other: 'fbCatOther',
} as const

function StatusBadge({ status, lang }: { status: FeedbackItem['status']; lang: Lang }) {
  const variant = status === 'new' ? 'accent' : status === 'seen' ? 'warn' : 'soft'
  const label = status === 'new' ? 'fbStatusNew' : status === 'seen' ? 'fbStatusSeen' : 'fbStatusDone'
  return <Badge variant={variant}>{t(label, lang)}</Badge>
}

function Row({ item, lang }: { item: FeedbackItem; lang: Lang }) {
  const [pending, start] = useTransition()
  const setStatus = (status: FeedbackItem['status']) => start(async () => setFeedbackStatus(item.id, status))

  return (
    <div className={cardClass()}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-body-sm text-ink-2">
        <StatusBadge status={item.status} lang={lang} />
        <Badge variant="soft">
          {t(CAT_LABEL[item.category], lang)}
        </Badge>
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
      <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">{item.body}</p>
      {item.pageUrl && <p className="mt-2 break-all text-caption text-muted">{item.pageUrl}</p>}
      <div className="mt-3 flex gap-2">
        {item.status !== 'seen' && (
          <button type="button" disabled={pending} onClick={() => setStatus('seen')} className={buttonClass({ variant: 'outline', size: 'sm' })}>
            {t('fbStatusSeen', lang)}
          </button>
        )}
        {item.status !== 'done' && (
          <button type="button" disabled={pending} onClick={() => setStatus('done')} className={buttonClass({ variant: 'outline', size: 'sm' })}>
            {t('fbStatusDone', lang)}
          </button>
        )}
        {item.status !== 'new' && (
          <button type="button" disabled={pending} onClick={() => setStatus('new')} className={buttonClass({ variant: 'outline', size: 'sm' })}>
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
      <SegmentedControl label={t('admin.filter', lang)} className="mb-4 flex-wrap">
        {tabs.map((tab) => (
          <Segment key={tab.key} active={filter === tab.key} href={tab.key === 'all' ? '/admin/feedback' : `/admin/feedback?filter=${tab.key}`}>
            {tab.label} <span className="opacity-70">{counts[tab.key]}</span>
          </Segment>
        ))}
      </SegmentedControl>
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
