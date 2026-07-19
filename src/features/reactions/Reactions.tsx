'use client'
import { useTransition } from 'react'
import { SmilePlus } from 'lucide-react'
import { EmojiPickerPopover } from '@/shared/ui/EmojiPickerPopover'
import type { ReactionAgg } from './constants'
import { toggleReaction } from './actions'

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
  lang?: string
}) {
  const [pending, start] = useTransition()
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const react = (emoji: string) => {
    if (emoji) start(() => void toggleReaction({ targetType, targetId, emoji, path }))
  }
  const shown = reactions.filter((r) => r.count > 0)

  if (!canReact && shown.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!canReact || pending}
          onClick={() => react(r.emoji)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12.5px] transition-colors disabled:opacity-60 ${
            r.mine ? 'border-accent bg-accent/10 text-ink' : 'border-border bg-surface-2 text-ink-2 hover:border-border-strong'
          }`}
          title={r.mine ? say('remove reaction', 'снять реакцию') : say('reaction', 'реакция')}
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      {canReact && (
        // Якорный поповер (не по центру экрана): пикер висит рядом с кнопкой; портал
        // в body спасает от overflow/z-index карточки. Тултип на самой кнопке.
        <EmojiPickerPopover
          lang={lang}
          tooltip={say('Add reaction', 'Добавить реакцию')}
          onPick={react}
          button={
            <button
              type="button"
              aria-label={say('Add reaction', 'Добавить реакцию')}
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
