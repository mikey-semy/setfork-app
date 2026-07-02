'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { BadgeCheck, Check, EyeOff, Eye, Loader2, Sparkles } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
import type { ModFilter, ModItem } from './queries'
import { aiModerate, setModeration, setVerified } from './actions'

function StatusBadge({ s, lang }: { s: ModItem['moderation']; lang: Lang }) {
  if (s === 'hidden')
    return <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">{t('hiddenLabel', lang)}</span>
  if (s === 'flagged')
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">{t('flaggedLabel', lang)}</span>
  return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{t('statusActive', lang)}</span>
}

export function ModerationTable({
  items,
  counts,
  filter,
  lang,
}: {
  items: ModItem[]
  counts: { flagged: number; hidden: number }
  filter: ModFilter
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

  const tabs: { key: ModFilter; label: string; n?: number }[] = [
    { key: 'all', label: t('filterAll', lang) },
    { key: 'flagged', label: t('flaggedLabel', lang), n: counts.flagged },
    { key: 'hidden', label: t('hiddenLabel', lang), n: counts.hidden },
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
      <div className="mb-4 flex gap-4 border-b border-border text-[13.5px] font-semibold">
        {tabs.map((tb) => (
          <Link
            key={tb.key}
            href={tb.key === 'all' ? '/admin/moderation' : `/admin/moderation?filter=${tb.key}`}
            className={`pb-2.5 ${filter === tb.key ? 'border-b-2 border-ink text-ink' : 'text-ink-2 hover:text-ink'}`}
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
                  {it.visibility === 'private' && <span className="text-[11px] text-muted">private</span>}
                  <span className="font-mono text-[11px] text-muted">★{it.starsCount}</span>
                </div>
                <div className="truncate text-[12.5px] text-ink-2">{tr(it.title, lang)}</div>
                {it.moderationReason && <div className="text-[11.5px] text-warn">{it.moderationReason}</div>}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {it.moderation !== 'active' && (
                  <button
                    onClick={() => start(() => void setModeration(it.id, 'active'))}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-ok/50 px-2.5 py-1.5 text-[12px] font-medium text-ok disabled:opacity-60"
                  >
                    <Check size={13} /> {t('approveAction', lang)}
                  </button>
                )}
                <button
                  onClick={() => start(() => void setVerified(it.id, !it.verified))}
                  disabled={pending}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-60 ${
                    it.verified ? 'border-ok text-ok' : 'border-border text-ink-2 hover:text-ink'
                  }`}
                >
                  <BadgeCheck size={13} /> {it.verified ? t('unverifyAction', lang) : t('verifyAction', lang)}
                </button>
                <button
                  onClick={() => runAi(it.id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-60"
                >
                  {busy === it.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t('aiCheck', lang)}
                </button>
                <button
                  onClick={() => start(() => void setModeration(it.id, hidden ? 'active' : 'hidden'))}
                  disabled={pending}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-60 ${
                    hidden ? 'border-border text-ink-2 hover:text-ink' : 'border-danger/40 text-danger'
                  }`}
                >
                  {hidden ? <Eye size={13} /> : <EyeOff size={13} />} {hidden ? t('unhideAction', lang) : t('hideAction', lang)}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
