'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

/** Значение-пустышка для «нет модели». */
export const NONE = '__none__'

/** id — идентификатор модели (моно), price — готовая строка цены, priceClass —
 *  цветовой класс (зелёный дёшево / жёлтый средне / красный дорого). */
export type Option = { value: string; id: string; price?: string; priceClass?: string }

/** Комбобокс выбора модели: список с поиском и кнопкой очистки поиска.
 *  Значение уходит в форму через скрытый input[name]. */
export function ModelSelect({
  name,
  defaultValue,
  options,
  placeholder,
  allowEmpty,
}: {
  name: string
  defaultValue?: string
  options: Option[]
  placeholder?: string
  allowEmpty?: boolean
}) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.id.toLowerCase().includes(q)) : options
  }, [query, options])

  const selected = options.find((o) => o.value === value)
  const triggerLabel = selected?.id ?? value

  // Закрытие по клику вне и фокус в поиск при открытии.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', onDown)
      cancelAnimationFrame(id)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
    else setHighlight(0)
  }, [open])

  const pick = (v: string) => {
    setValue(v)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = filtered[highlight]
      if (o) pick(o.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={value} />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[42px] w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] outline-none focus:border-border-strong"
      >
        <span className={triggerLabel ? 'truncate font-mono text-[13px] text-ink' : 'text-muted'}>
          {triggerLabel || placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-md border border-border bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Search size={14} className="shrink-0 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Поиск модели…"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
            />
            {query && (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-auto p-1">
            {allowEmpty && !query && (
              <Row selected={value === ''} highlighted={false} onClick={() => pick('')}>
                <span className="text-ink-2">—</span>
              </Row>
            )}
            {filtered.map((o, i) => (
              <Row
                key={o.value}
                selected={o.value === value}
                highlighted={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(o.value)}
              >
                <span className="truncate font-mono text-[12px]">{o.id}</span>
                {o.price && <span className={`ml-auto shrink-0 pl-4 tabular-nums text-[11.5px] ${o.priceClass ?? ''}`}>{o.price}</span>}
              </Row>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-[12.5px] text-muted">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  children,
  selected,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  children: React.ReactNode
  selected: boolean
  highlighted: boolean
  onClick: () => void
  onMouseEnter?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-3 text-left text-[13.5px] text-ink ${
        highlighted ? 'bg-[var(--accent-soft)] text-accent' : ''
      }`}
    >
      {selected && (
        <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
          <Check size={14} />
        </span>
      )}
      {children}
    </button>
  )
}
