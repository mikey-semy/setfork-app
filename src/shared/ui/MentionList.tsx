'use client'

import { TEXT } from './control'
import type { MentionUser } from './use-mention'

/**
 * Подсказка людей: аватар + @ник, выбор мышью или стрелками. Одна на упоминания
 * в редакторе («@» посреди текста — список у каретки, `at`) и на поле ника
 * (UserHandleInput — список под полем во всю его ширину, `at` не передают).
 */
export function MentionList({
  users,
  index,
  onHover,
  onPick,
  at,
  id,
}: {
  users: MentionUser[]
  index: number
  onHover: (i: number) => void
  onPick: (u: MentionUser) => void
  /** Координаты каретки; `undefined` — список под полем во всю его ширину. */
  at?: { top: number; left: number } | null
  /** id списка для aria-controls поля; строки получают `${id}-${i}`. */
  id?: string
}) {
  const below = at === undefined
  return (
    <div
      id={id}
      role="listbox"
      // Под полем — во всю его ширину (inset-x-0): на 320px фиксированная w-64 вылезла бы
      // за экран вместе с полем, а поле уже ужато рядом с кнопкой.
      className={`absolute z-40 max-h-52 overflow-y-auto rounded-md border border-border bg-surface shadow-lg ${
        below ? 'inset-x-0 top-full mt-1' : 'w-64 cap-viewport'
      }`}
      style={below ? undefined : { top: (at?.top ?? 0) + 20, left: at?.left ?? 8 }}
    >
      {users.map((u, i) => (
        <button
          key={u.handle}
          id={id ? `${id}-${i}` : undefined}
          type="button"
          role="option"
          aria-selected={i === index}
          // mousedown, а не click: поле не должно потерять фокус до вставки.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(u)
          }}
          onMouseEnter={() => onHover(i)}
          // pointer-coarse:min-h-11 — тач-цель 44px, как у PickerRow; на десктопе список плотный.
          className={`flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 pointer-coarse:min-h-11 text-left ${TEXT.body} ${i === index ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" /> : <span className="h-5 w-5 shrink-0 rounded-full bg-surface-2" />}
          <span className="min-w-0 truncate font-medium">@{u.handle}</span>
        </button>
      ))}
    </div>
  )
}
