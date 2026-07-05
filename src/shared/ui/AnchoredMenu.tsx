'use client'

import { useEffect, useState } from 'react'

// Якорный дропдаун «под кнопкой» (паттерн BranchPicker / GitHub branch-picker):
// relative-обёртка + прозрачный клик-мимо слой + absolute-меню. Esc закрывает.
// Заменяет ~копии этого скелета в пикерах issues (assignee/label/milestone).
//
// Центр-модалки — это ДРУГОЙ паттерн (см. OverlayPanel).

export function AnchoredMenu({
  button,
  children,
  align = 'left',
  width = 240,
  className = '',
}: {
  /** Триггер: получает toggle и текущее open; сам рисует нужную кнопку. */
  button: (toggle: () => void, open: boolean) => React.ReactNode
  /** Содержимое меню: получает close (вызывать при выборе). */
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      {button(() => setOpen((o) => !o), open)}
      {open && (
        <>
          {/* Прозрачный слой: клик мимо закрывает (как GitHub, без затемнения). */}
          <div className="fixed inset-0 z-10" onClick={close} />
          <div
            style={{ width }}
            className={`absolute z-20 mt-1 max-w-[calc(100vw-24px)] overflow-hidden rounded-md border border-border bg-surface shadow-lg ${align === 'right' ? 'right-0' : 'left-0'} ${className}`}
          >
            {children(close)}
          </div>
        </>
      )}
    </div>
  )
}
