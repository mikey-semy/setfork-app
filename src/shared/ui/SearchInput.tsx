'use client'

import type { KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

// Контролируемое поле поиска с иконкой и кнопкой очистки (×).
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  onKeyDown,
  autoFocus,
  name,
  clearLabel = 'Clear',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  name?: string
  clearLabel?: string
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 text-muted" />
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border border-border bg-surface-2 py-2 pl-8 pr-8 text-[13px] text-ink outline-none focus:border-border-strong',
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="absolute right-1.5 grid h-6 w-6 place-items-center rounded text-muted hover:text-ink"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
