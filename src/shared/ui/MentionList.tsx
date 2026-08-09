'use client'

import { TEXT } from './control'
import type { MentionUser } from './use-mention'

/** Подсказка людей при вводе «@»: список у каретки, выбор мышью или стрелками. */
export function MentionList({
  users,
  index,
  onHover,
  onPick,
  at,
}: {
  users: MentionUser[]
  index: number
  onHover: (i: number) => void
  onPick: (u: MentionUser) => void
  at: { top: number; left: number } | null
}) {
  return (
    <div
      className="absolute z-40 max-h-52 w-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
      style={{ top: (at?.top ?? 0) + 20, left: at?.left ?? 8 }}
    >
      {users.map((u, i) => (
        <button
          key={u.handle}
          type="button"
          // mousedown, а не click: поле не должно потерять фокус до вставки.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(u)
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${TEXT.body} ${i === index ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-surface-2" />}
          <span className="font-medium">@{u.handle}</span>
        </button>
      ))}
    </div>
  )
}
