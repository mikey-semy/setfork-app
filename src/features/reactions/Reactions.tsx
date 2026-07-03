'use client'
import { useTransition } from 'react'
import { SmilePlus } from 'lucide-react'
import { REACTION_EMOJI, type ReactionAgg } from './constants'
import { toggleReaction } from './actions'

// Чипы реакций + пикер (нативный <details>, без внешних зависимостей).
export function Reactions({
  targetType,
  targetId,
  reactions,
  canReact,
  path,
}: {
  targetType: string
  targetId: string
  reactions: ReactionAgg[]
  canReact: boolean
  path: string
}) {
  const [pending, start] = useTransition()
  const react = (emoji: string) => start(() => void toggleReaction({ targetType, targetId, emoji, path }))
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
          title={r.mine ? 'снять реакцию' : 'реакция'}
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      {canReact && (
        <details className="relative">
          <summary className="inline-flex cursor-pointer list-none items-center rounded-full border border-border bg-surface-2 px-2 py-1 text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <SmilePlus size={14} />
          </summary>
          <div className="absolute left-0 z-20 mt-1 flex gap-0.5 rounded-lg border border-border bg-surface p-1.5 shadow-lg">
            {REACTION_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                disabled={pending}
                onClick={(ev) => {
                  react(e)
                  ev.currentTarget.closest('details')?.removeAttribute('open')
                }}
                className="rounded px-1.5 py-0.5 text-[16px] hover:bg-surface-2"
              >
                {e}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
