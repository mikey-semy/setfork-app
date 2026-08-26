'use client'
import { useTransition } from 'react'
import { SmilePlus } from 'lucide-react'
import { EmojiPickerPopover } from '@/shared/ui/EmojiPickerPopover'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { ReactionAgg } from './constants'
import { toggleReaction } from './actions'
import { t, type Lang } from '@/shared/i18n'
import { Chip } from '@/shared/ui/Chip'

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
          <Chip disabled={!canReact || pending} onClick={() => react(r.emoji)} selected={r.mine}>
            <span>{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </Chip>
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
            <Chip aria-label={t('reactions.addReaction', lang)} className="text-muted">
              <SmilePlus size={14} />
            </Chip>
          }
        />
      )}
    </div>
  )
}
