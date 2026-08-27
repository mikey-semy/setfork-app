'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { t, tr, type Lang } from '@/shared/i18n'
import { Badge } from '@/shared/ui/badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { setReportStatus } from './actions'
import type { ReportFilter, ReportItem } from './queries'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'

const REASON_LABEL = {
  illegal: 'rpReasonIllegal',
  spam: 'rpReasonSpam',
  copyright: 'rpReasonCopyright',
  privacy: 'rpReasonPrivacy',
  other: 'rpReasonOther',
} as const

const STATUS_LABEL = {
  new: 'rpStatusNew',
  reviewed: 'rpStatusReviewed',
  actioned: 'rpStatusActioned',
  dismissed: 'rpStatusDismissed',
} as const

function StatusBadge({ status, lang }: { status: ReportItem['status']; lang: Lang }) {
  const variant =
    status === 'new' ? 'accent' : status === 'actioned' ? 'ok' : status === 'reviewed' ? 'warn' : 'soft'
  return <Badge variant={variant}>{t(STATUS_LABEL[status], lang)}</Badge>
}

function Row({ item, lang }: { item: ReportItem; lang: Lang }) {
  const [pending, start] = useTransition()
  const setStatus = (status: ReportItem['status']) => start(async () => setReportStatus(item.id, status))
  const listPath = item.ownerHandle ? `/${item.ownerHandle}/${item.listSlug}` : null

  return (
    <div className={cardClass()}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-body-sm text-ink-2">
        <StatusBadge status={item.status} lang={lang} />
        <Badge variant="danger">{t(REASON_LABEL[item.reason], lang)}</Badge>
        {listPath ? (
          <Link href={listPath} className="font-semibold text-ink hover:underline">
            {tr(item.listTitle, lang) || item.listSlug}
          </Link>
        ) : (
          <span className="font-semibold text-ink">{item.listSlug}</span>
        )}
        <span className="ml-auto text-muted">{new Date(item.createdAt).toLocaleString()}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-body-sm text-muted">
        {item.reporterHandle ? (
          <Link href={`/${item.reporterHandle}`} className="hover:text-ink-2">
            {item.reporterHandle}
          </Link>
        ) : (
          <span>{t('fbAnon', lang)}</span>
        )}
        {item.email && <span>{item.email}</span>}
      </div>
      <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">{item.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['reviewed', 'actioned', 'dismissed'] as const)
          .filter((s) => s !== item.status)
          .map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => setStatus(s)} className={buttonClass({ variant: 'outline', size: 'sm' })}>
              {t(STATUS_LABEL[s], lang)}
            </button>
          ))}
        {item.status !== 'new' && (
          <button type="button" disabled={pending} onClick={() => setStatus('new')} className={buttonClass({ variant: 'outline', size: 'sm' })}>
            {t('rpStatusNew', lang)}
          </button>
        )}
      </div>
    </div>
  )
}

export function ReportsTable({
  items,
  counts,
  filter,
  lang,
}: {
  items: ReportItem[]
  counts: Record<ReportFilter, number>
  filter: ReportFilter
  lang: Lang
}) {
  const tabs: { key: ReportFilter; label: string }[] = [
    { key: 'all', label: t('fbAll', lang) },
    { key: 'new', label: t('rpStatusNew', lang) },
    { key: 'reviewed', label: t('rpStatusReviewed', lang) },
    { key: 'actioned', label: t('rpStatusActioned', lang) },
    { key: 'dismissed', label: t('rpStatusDismissed', lang) },
  ]
  return (
    <div>
      <SegmentedControl label={t('admin.filter', lang)} className="mb-4 flex-wrap">
        {tabs.map((tab) => (
          <Segment key={tab.key} active={filter === tab.key} href={tab.key === 'all' ? '/admin/reports' : `/admin/reports?filter=${tab.key}`}>
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
