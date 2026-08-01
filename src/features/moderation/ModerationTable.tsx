'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { BadgeCheck, Check, EyeOff, Eye, Loader2, Sparkles } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
import { Badge } from '@/shared/ui/badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { Tooltip } from '@/shared/ui/Tooltip'
import { toast } from '@/shared/ui/toast'
import type { ModFilter, ModItem } from './queries'
import { aiModerate, setModeration, setVerified } from './actions'

function StatusBadge({ s, lang }: { s: ModItem['moderation']; lang: Lang }) {
  if (s === 'hidden') return <Badge variant="danger">{t('hiddenLabel', lang)}</Badge>
  if (s === 'flagged') return <Badge variant="warn">{t('flaggedLabel', lang)}</Badge>
  if (s === 'pending') return <Badge variant="accent">{t('pendingLabel', lang)}</Badge>
  return <Badge variant="soft">{t('statusActive', lang)}</Badge>
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
      if ('error' in res) toast.error(res.error)
      else if (res.flagged) toast.warning(res.reason)
    })
  }

  return (
    <div>
      {/* Единый TabNav (как Explore/профиль): полоска активной вкладки, не влезшие
          фильтры уезжают в «…»-меню — счётчики сохраняются. -mx-4 компенсирует
          внутренний паддинг ряда, чтобы вкладки стояли по левому краю контента. */}
      <div className="-mx-4 mb-4">
        <TabNav scope="moderation" overflow={{ moreLabel: t('moreTabs', lang) }}>
          {tabs.map((tb) => (
            <TabItem
              key={tb.key}
              href={tb.key === 'all' ? '/admin/moderation' : `/admin/moderation?filter=${tb.key}`}
              on={filter === tb.key}
              label={tb.label}
              count={tb.n}
            />
          ))}
        </TabNav>
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 && <EmptyState variant="inline" hint={t('nothingFound', lang)} />}
        {items.map((it) => {
          const hidden = it.moderation === 'hidden'
          return (
            <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/${it.ownerHandle}/${it.slug}`} className="truncate font-mono text-[0.8125rem] text-accent hover:underline">
                    {it.ownerHandle}/{it.slug}
                  </Link>
                  {it.verified && <BadgeCheck size={15} className="text-ok" />}
                  <StatusBadge s={it.moderation} lang={lang} />
                  {it.appealedAt && <Badge variant="accent">{t('appealedLabel', lang)}</Badge>}
                  {it.moderationSeverity >= 3 && <Badge variant="danger">{t('severeLabel', lang)}</Badge>}
                  {it.visibility === 'private' && <span className="text-[0.6875rem] text-muted">private</span>}
                  <span className="font-mono text-[0.6875rem] text-muted">★{it.starsCount}</span>
                </div>
                <div className="truncate text-[0.78125rem] text-ink-2">{tr(it.title, lang)}</div>
                {it.moderationReason && <div className="text-[0.6875rem] text-warn">{it.moderationReason}</div>}
              </div>

              {/* Действия — компактные иконки с тултипами (фидбек владельца: кнопки-простыни
                  не влезали на мобильный). aria-label дублирует тултип для доступности. */}
              <div className="flex shrink-0 items-center gap-1">
                {it.moderation !== 'active' && (
                  <Tooltip label={t('approveAction', lang)}>
                    <button
                      type="button"
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
                    type="button"
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
                    type="button"
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
                    type="button"
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
