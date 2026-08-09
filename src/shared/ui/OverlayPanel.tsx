'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PANEL_HEAD, PANEL_PAD } from './control'

// Единая модальная панель-оверлей для всех центр-портальных пикеров
// (эмодзи, папки, пины, фильтр, assignee/label/milestone, мобильный поиск).
// Портал в body, затемнённый фон, клик-мимо и Esc закрывают, опциональный
// заголовок с крестиком. Заменяет ~10 копий одинакового скелета.
//
// Якорные дропдауны «под кнопкой» (BranchPicker) — это ДРУГОЙ паттерн
// (absolute к триггеру), их сюда не сводим.

export function OverlayPanel({
  open,
  onClose,
  children,
  title,
  width = 340,
  align = 'center',
  className = '',
  bare = false,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: React.ReactNode
  /** Фикс-ширина панели; 0/undefined — по содержимому (эмодзи-пикер и т.п.). */
  width?: number
  /** center — по центру экрана; top — вверху (для поиска/списков, как GitHub). */
  align?: 'center' | 'top'
  className?: string
  /** Содержимое само отвечает за поля (эмодзи-пикер, галерея): панель их не ставит. */
  bare?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className={`sf-overlay-in fixed inset-0 z-50 flex justify-center bg-black/30 p-4 ${align === 'center' ? 'items-center' : 'items-start pt-20'}`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={width ? { width } : undefined}
        className={`sf-pop-in max-w-full rounded-lg border border-border bg-surface shadow-card ${className}`}
      >
        {title !== undefined && (
          <div className={`flex items-center justify-between border-b border-border ${PANEL_HEAD}`}>
            <span className="text-[0.8125rem] font-semibold text-ink">{title}</span>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          </div>
        )}
        {/* Тело всегда с полями панели: раньше отступ задавал КАЖДЫЙ вызывающий,
            и одни окна имели поля, другие упирались в края. */}
        <div className={bare ? undefined : PANEL_PAD}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
