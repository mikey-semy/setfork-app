'use client'
import type { IssueHit } from './use-issue-ref'

/**
 * Подсказка «#123 — задача» под кареткой. Выбор мышью идёт по `onMouseDown` с отменой
 * умолчания: `click` пришёл бы уже после blur поля, а тот закрывает список.
 */
export function IssueRefList({
  hits,
  index,
  anchor,
  onHover,
  onPick,
}: {
  hits: IssueHit[]
  index: number
  anchor: { top: number; left: number } | null
  onHover: (i: number) => void
  onPick: (hit: IssueHit) => void
}) {
  if (!hits.length) return null
  return (
    <div className="absolute z-20 max-h-52 w-72 overflow-y-auto rounded-md border border-border bg-surface shadow-lg" style={{ top: anchor?.top ?? 8, left: anchor?.left ?? 8 }}>
      {hits.map((h, i) => (
        <button
          key={h.number}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(h)
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body ${i === index ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
        >
          <span className={`font-mono ${h.status === 'closed' ? 'text-accent' : 'text-ok'}`}>#{h.number}</span>
          <span className="min-w-0 flex-1 truncate">{h.title}</span>
        </button>
      ))}
    </div>
  )
}
