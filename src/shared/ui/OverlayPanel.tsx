'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

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
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: React.ReactNode
  width?: number
  /** center — по центру экрана; top — вверху (для поиска/списков, как GitHub). */
  align?: 'center' | 'top'
  className?: string
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
      className={`fixed inset-0 z-[100] flex justify-center bg-black/30 p-4 ${align === 'center' ? 'items-center' : 'items-start pt-20'}`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className={`max-w-full rounded-lg border border-border bg-surface shadow-card ${className}`}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="text-[13.5px] font-semibold text-ink">{title}</span>
            <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
