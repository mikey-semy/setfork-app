'use client'
import { useTransition } from 'react'
import { SmilePlus } from 'lucide-react'
import { EmojiPickerPopover } from '@/shared/ui/EmojiPickerPopover'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { ReactionAgg } from './constants'
import { toggleReaction } from './actions'
import { t, type Lang } from '@/shared/i18n'

export function Reactions({
  targetType,
  targetId,
  reactions,
  canReact,
  path,
  lang = 'en',
}: {
  targetType: string
  targetId: string
  reactions: ReactionAgg[]
  canReact: boolean
  path: string
  lang?: Lang
}) {
  const [pending, start] = useTransition()
  const react = (emoji: string) => {
    if (emoji) start(() => void toggleReaction({ targetType, targetId, emoji, path }))
  }
  const shown = reactions.filter((r) => r.count > 0)

  if (!canReact && shown.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((r) => (
        <Tooltip key={r.emoji} label={r.mine ? t('reactions.removeReaction', lang) : t('reactions.reaction', lang)}>
          <button
            type="button"
            disabled={!canReact || pending}
            onClick={() => react(r.emoji)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-body-sm transition-colors disabled:opacity-60 ${
              r.mine ? 'border-accent bg-accent/10 text-ink' : 'border-border bg-surface-2 text-ink-2 hover:border-border-strong'
            }`}
          >
            <span>{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        </Tooltip>
      ))}

      {canReact && (
        // Якорный поповер (не по центру экрана): пикер висит рядом с кнопкой; портал
        // в body спасает от overflow/z-index карточки. Тултип на самой кнопке.
        <EmojiPickerPopover
          lang={lang}
          tooltip={t('reactions.addReaction', lang)}
          onPick={react}
          button={
            <button
              type="button"
              aria-label={t('reactions.addReaction', lang)}
              className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-1 text-muted hover:text-ink"
            >
              <SmilePlus size={14} />
            </button>
          }
        />
      )}
    </div>
  )
}
