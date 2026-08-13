'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { t, tr, type Lang } from '@/shared/i18n'
import { Badge } from '@/shared/ui/badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { setReportStatus } from './actions'
import type { ReportFilter, ReportItem } from './queries'
import { cardClass } from '@/shared/ui/card-style'

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
  const cls =
    status === 'new'
      ? 'bg-accent/10 text-accent'
      : status === 'actioned'
        ? 'bg-ok/15 text-ok'
        : status === 'reviewed'
          ? 'bg-warn/10 text-ink-2'
          : 'bg-surface-2 text-muted'
  return <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${cls}`}>{t(STATUS_LABEL[status], lang)}</span>
}

function Row({ item, lang }: { item: ReportItem; lang: Lang }) {
  const [pending, start] = useTransition()
  const setStatus = (status: ReportItem['status']) => start(async () => setReportStatus(item.id, status))
  const btn =
    'rounded-md border border-border bg-surface px-2.5 py-1 text-[0.78125rem] font-semibold text-ink-2 hover:border-border-strong hover:text-ink disabled:opacity-50'
  const listPath = item.ownerHandle ? `/${item.ownerHandle}/${item.listSlug}` : null

  return (
    <div className={cardClass()}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.78125rem] text-ink-2">
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
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.78125rem] text-muted">
        {item.reporterHandle ? (
          <Link href={`/${item.reporterHandle}`} className="hover:text-ink-2">
            {item.reporterHandle}
          </Link>
        ) : (
          <span>{t('fbAnon', lang)}</span>
        )}
        {item.email && <span>{item.email}</span>}
      </div>
      <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ink">{item.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['reviewed', 'actioned', 'dismissed'] as const)
          .filter((s) => s !== item.status)
          .map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => setStatus(s)} className={btn}>
              {t(STATUS_LABEL[s], lang)}
            </button>
          ))}
        {item.status !== 'new' && (
          <button type="button" disabled={pending} onClick={() => setStatus('new')} className={btn}>
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
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === 'all' ? '/admin/reports' : `/admin/reports?filter=${tab.key}`}
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
