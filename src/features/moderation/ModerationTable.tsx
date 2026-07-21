'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { BadgeCheck, Check, EyeOff, Eye, Loader2, Sparkles } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { ModFilter, ModItem } from './queries'
import { aiModerate, setModeration, setVerified } from './actions'

function StatusBadge({ s, lang }: { s: ModItem['moderation']; lang: Lang }) {
  if (s === 'hidden')
    return <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">{t('hiddenLabel', lang)}</span>
  if (s === 'flagged')
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">{t('flaggedLabel', lang)}</span>
  if (s === 'pending')
    return <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{t('pendingLabel', lang)}</span>
  return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{t('statusActive', lang)}</span>
}

export function ModerationTable({
  items,
  counts,
  filter,
  lang,
}: {
  items: ModItem[]
  counts: { pending: number; flagged: number; hidden: number }
  filter: ModFilter
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

  const tabs: { key: ModFilter; label: string; n?: number }[] = [
    { key: 'all', label: t('filterAll', lang) },
    { key: 'pending', label: t('pendingLabel', lang), n: counts.pending },
    { key: 'flagged', label: t('flaggedLabel', lang), n: counts.flagged },
    { key: 'hidden', label: t('hiddenLabel', lang), n: counts.hidden },
    { key: 'sample', label: t('sampleLabel', lang) },
  ]

  const runAi = (id: string) => {
    setBusy(id)
    start(async () => {
      const res = await aiModerate(id)
      setBusy(null)
      if ('error' in res) alert(res.error)
      else if (res.flagged) alert(`⚠ ${res.reason}`)
    })
  }

  return (
    <div>
      {/* На мобильном табы скроллятся, не ломая строк (фидбек владельца). */}
      <div className="no-scrollbar mb-4 flex gap-4 overflow-x-auto border-b border-border text-[13.5px] font-semibold">
        {tabs.map((tb) => (
          <Link
            key={tb.key}
            href={tb.key === 'all' ? '/admin/moderation' : `/admin/moderation?filter=${tb.key}`}
            className={`shrink-0 whitespace-nowrap pb-2.5 ${filter === tb.key ? 'border-b-2 border-ink text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {tb.label}
            {tb.n != null && tb.n > 0 && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2">{tb.n}</span>}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 && <div className="py-10 text-center text-[13px] text-muted">{t('nothingFound', lang)}</div>}
        {items.map((it) => {
          const hidden = it.moderation === 'hidden'
          return (
            <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/${it.ownerHandle}/${it.slug}`} className="truncate font-mono text-[13px] text-accent hover:underline">
                    {it.ownerHandle}/{it.slug}
                  </Link>
                  {it.verified && <BadgeCheck size={15} className="text-ok" />}
                  <StatusBadge s={it.moderation} lang={lang} />
                  {it.appealedAt && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{t('appealedLabel', lang)}</span>
                  )}
                  {it.moderationSeverity >= 3 && (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">{t('severeLabel', lang)}</span>
                  )}
                  {it.visibility === 'private' && <span className="text-[11px] text-muted">private</span>}
                  <span className="font-mono text-[11px] text-muted">★{it.starsCount}</span>
                </div>
                <div className="truncate text-[12.5px] text-ink-2">{tr(it.title, lang)}</div>
                {it.moderationReason && <div className="text-[11.5px] text-warn">{it.moderationReason}</div>}
              </div>

              {/* Действия — компактные иконки с тултипами (фидбек владельца: кнопки-простыни
                  не влезали на мобильный). aria-label дублирует тултип для доступности. */}
              <div className="flex shrink-0 items-center gap-1">
                {it.moderation !== 'active' && (
                  <Tooltip label={t('approveAction', lang)}>
                    <button
                      onClick={() => start(() => void setModeration(it.id, 'active'))}
                      disabled={pending}
                      aria-label={t('approveAction', lang)}
                      className="grid h-8 w-8 place-items-center rounded-md border border-ok/50 text-ok disabled:opacity-60"
                    >
                      <Check size={14} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip label={it.verified ? t('unverifyAction', lang) : t('verifyAction', lang)}>
                  <button
                    onClick={() => start(() => void setVerified(it.id, !it.verified))}
                    disabled={pending}
                    aria-label={it.verified ? t('unverifyAction', lang) : t('verifyAction', lang)}
                    className={`grid h-8 w-8 place-items-center rounded-md border disabled:opacity-60 ${
                      it.verified ? 'border-ok text-ok' : 'border-border text-ink-2 hover:text-ink'
                    }`}
                  >
                    <BadgeCheck size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={t('aiCheck', lang)}>
                  <button
                    onClick={() => runAi(it.id)}
                    disabled={pending}
                    aria-label={t('aiCheck', lang)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border text-ink-2 hover:text-ink disabled:opacity-60"
                  >
                    {busy === it.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  </button>
                </Tooltip>
                <Tooltip label={hidden ? t('unhideAction', lang) : t('hideAction', lang)}>
                  <button
                    onClick={() => start(() => void setModeration(it.id, hidden ? 'active' : 'hidden'))}
                    disabled={pending}
                    aria-label={hidden ? t('unhideAction', lang) : t('hideAction', lang)}
                    className={`grid h-8 w-8 place-items-center rounded-md border disabled:opacity-60 ${
                      hidden ? 'border-border text-ink-2 hover:text-ink' : 'border-danger/40 text-danger'
                    }`}
                  >
                    {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
