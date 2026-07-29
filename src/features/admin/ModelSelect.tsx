'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

/** Значение-пустышка для «нет модели». */
export const NONE = '__none__'

/** id — идентификатор модели (моно), label — человеческое имя (URI не показываем),
 *  family — семейство (бейдж), price — готовая строка цены, priceClass —
 *  цветовой класс (зелёный дёшево / жёлтый средне / красный дорого). */
export type Option = { value: string; id: string; label?: string; family?: string; price?: string; priceClass?: string }

const parseCsv = (s: string | undefined): string[] => (s || '').split(',').map((x) => x.trim()).filter(Boolean)

/** Комбобокс выбора модели: список с поиском и кнопкой очистки поиска.
 *  Значение уходит в форму через скрытый input[name].
 *
 *  multiple — выбор нескольких: значение уезжает CSV, выбранное показываем чипами.
 *  ПОРЯДОК ЗНАЧИМ и хранится как порядок выбора (у совета 1-я модель ведёт промежуточные шаги,
 *  остальные раздаются экспертам по кругу) — поэтому список, а не множество, и чипы нумерованы. */
export function ModelSelect({
  name,
  defaultValue,
  options,
  placeholder,
  allowEmpty,
  multiple,
  allowCustom,
  customHint,
}: {
  name: string
  defaultValue?: string
  options: Option[]
  placeholder?: string
  allowEmpty?: boolean
  multiple?: boolean
  /** Каталог провайдера не приехал (или модели в нём нет) — id можно ввести прямо в поиске.
   *  Раньше на этот случай поле подменялось голым input: связка выглядела как удалённая
   *  фича выбора моделей. Виджет один, деградирует только наполнение списка. */
  allowCustom?: boolean
  /** Подпись строки свободного ввода, например «Использовать». */
  customHint?: string
}) {
  const [values, setValues] = useState<string[]>(() => (multiple ? parseCsv(defaultValue) : defaultValue ? [defaultValue] : []))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const value = values[0] ?? ''
  const optOf = (v: string) => options.find((o) => o.value === v)
  const labelOf = (v: string) => optOf(v)?.label ?? optOf(v)?.id ?? v

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.id.toLowerCase().includes(q) || o.label?.toLowerCase().includes(q) || o.family?.toLowerCase().includes(q)) : options
  }, [query, options])

  const triggerLabel = multiple ? (values.length ? `Выбрано моделей: ${values.length}` : '') : labelOf(value)

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
    if (multiple) {
      // Тумблер, список НЕ закрываем: обычно отмечают несколько подряд. Новая уходит в КОНЕЦ — порядок значим.
      setValues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
      return
    }
    setValues(v ? [v] : [])
    setOpen(false)
  }

  // Свободный id: показываем, только когда в каталоге нет ровно такого значения —
  // иначе строка дублировала бы обычную опцию.
  const custom = allowCustom ? query.trim() : ''
  const showCustom = custom.length > 0 && !options.some((o) => o.value === custom)

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
      // Ничего не подошло, но id набран руками — Enter принимает его: с пустым
      // каталогом это единственный способ ввести модель.
      if (o) pick(o.value)
      else if (showCustom) pick(custom)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    // Корень ловит клик-вне; выпадашка позиционируется от ВНУТРЕННЕЙ обёртки — иначе чипы (они тоже
    // в корне) растят его высоту, и список уезжает вниз с каждой выбранной моделью.
    <div ref={rootRef}>
      <input type="hidden" name={name} value={multiple ? values.join(',') : value} />

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-[42px] w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] outline-hidden focus:border-border-strong"
        >
          <span className={triggerLabel ? 'truncate text-[13px] text-ink' : 'text-muted'}>
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
                className="w-full bg-transparent text-[13px] text-ink outline-hidden placeholder:text-muted"
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
                  selected={values.includes(o.value)}
                  highlighted={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(o.value)}
                >
                  <span className="truncate text-[12.5px]">{o.label ?? o.id}</span>
                  {o.family && (
                    <span className="ml-1.5 shrink-0 rounded-full border border-border bg-surface-2 px-1.5 py-px text-[10px] text-muted">
                      {o.family}
                    </span>
                  )}
                  {o.price && <span className={`ml-auto shrink-0 pl-4 tabular-nums text-[11.5px] ${o.priceClass ?? ''}`}>{o.price}</span>}
                </Row>
              ))}
              {showCustom && (
                <Row selected={values.includes(custom)} highlighted={false} onClick={() => pick(custom)}>
                  <span className="truncate text-[12.5px]">
                    {customHint ?? 'Использовать'} <span className="font-mono text-ink-2">{custom}</span>
                  </span>
                </Row>
              )}
              {filtered.length === 0 && !showCustom && (
                <div className="px-3 py-4 text-center text-[12.5px] text-muted">Ничего не найдено</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Выбранное: чипы нумерованы, потому что порядок несёт смысл (см. коммент к multiple). */}
      {multiple && values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span key={v} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 py-1 pl-1.5 pr-1 text-[11.5px] text-ink-2">
              <span className="grid size-4 shrink-0 place-items-center rounded bg-surface text-[10px] tabular-nums text-muted">{i + 1}</span>
              <span>{labelOf(v)}</span>
              <button
                type="button"
                aria-label={`Убрать ${labelOf(v)}`}
                onClick={() => pick(v)}
                className="grid size-4 shrink-0 place-items-center rounded text-muted hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))}
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
  // min-h-11 = 44px: строка списка — тач-цель, на мобиле в неё целятся пальцем.
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`relative flex min-h-11 w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-3 text-left text-[13.5px] text-ink ${
        highlighted ? 'bg-(--accent-soft) text-accent' : ''
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
