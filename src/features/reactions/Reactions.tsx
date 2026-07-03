'use client'
import { useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { SmilePlus } from 'lucide-react'
import emojiData from '@emoji-mart/data'
import type { ReactionAgg } from './constants'
import { toggleReaction } from './actions'

// Полный emoji-mart пикер (тысячи эмодзи + поиск), только клиент, без SSR.
const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })

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
  const [open, setOpen] = useState(false)
  const { resolvedTheme } = useTheme()
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
          title={r.mine ? (lang === 'ru' ? 'снять реакцию' : 'remove reaction') : lang === 'ru' ? 'реакция' : 'reaction'}
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      {canReact && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={lang === 'ru' ? 'Добавить реакцию' : 'Add reaction'}
            className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-1 text-muted hover:text-ink"
          >
            <SmilePlus size={14} />
          </button>
          {open && (
            <>
              {/* клик снаружи — закрыть */}
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute left-0 z-20 mt-1">
                <EmojiPicker
                  data={emojiData}
                  locale={lang === 'ru' ? 'ru' : 'en'}
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  previewPosition="none"
                  skinTonePosition="none"
                  onEmojiSelect={(e: { native?: string }) => {
                    if (e.native) react(e.native)
                    setOpen(false)
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
