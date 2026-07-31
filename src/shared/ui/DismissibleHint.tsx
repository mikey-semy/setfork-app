'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/**
 * Закрываемая плашка-подсказка (крестик в углу). Закрытие запоминается в
 * localStorage по storageKey — чтобы не мозолила глаза на каждой загрузке.
 * Стили коробки (рамка/фон/отступы) передаются в className; сюда — только
 * relative + место под крестик и логика скрытия.
 */
export function DismissibleHint({ storageKey, className, children }: { storageKey: string; className?: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === '1') setHidden(true)
    } catch {
      /* приватный режим/недоступен — просто показываем */
    }
  }, [storageKey])

  if (hidden) return null
  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      /* нет доступа — скрываем хотя бы в этой сессии */
    }
    setHidden(true)
  }

  return (
    <div className={cn('relative flex items-center gap-2.5 pr-9', className)}>
      {children}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Закрыть"
        className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md opacity-60 transition-opacity hover:opacity-100"
      >
        <X size={15} />
      </button>
    </div>
  )
}
