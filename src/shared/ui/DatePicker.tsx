'use client'

import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { AnchoredMenu } from './AnchoredMenu'

// Свой календарь-пикер даты (вместо нативного <input type="date">, у которого
// браузерный вид/локаль). Значение — 'YYYY-MM-DD' ('' = не задано). Пн-первый.

const MONTHS = {
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
const WD = { ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] }
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (v: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

export function DatePicker({
  value,
  onChange,
  lang = 'en',
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  lang?: 'ru' | 'en'
  placeholder?: string
}) {
  const ru = lang === 'ru'
  const selected = parse(value)
  const label = selected ? selected.toLocaleDateString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  return (
    <AnchoredMenu
      button={(toggle, open) => (
        <span className="inline-flex items-center">
          <button
            type="button"
            onClick={toggle}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.78125rem] transition-colors ${
              open ? 'border-border-strong' : 'border-border'
            } ${label ? 'text-ink' : 'text-muted'} hover:border-border-strong`}
          >
            <CalendarDays size={13} className="text-muted" />
            {label || placeholder || (ru ? 'выбрать дату' : 'pick a date')}
          </button>
          {value && (
            <button type="button" onClick={() => onChange('')} className="ml-1 text-muted hover:text-danger" aria-label={ru ? 'Очистить' : 'Clear'}>
              <X size={13} />
            </button>
          )}
        </span>
      )}
    >
      {(close) => <Calendar selected={selected} onPick={(d) => { onChange(ymd(d)); close() }} ru={ru} />}
    </AnchoredMenu>
  )
}

function Calendar({ selected, onPick, ru }: { selected: Date | null; onPick: (d: Date) => void; ru: boolean }) {
  const [view, setView] = useState(() => (selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : startOfThisMonth()))
  const y = view.getFullYear()
  const m = view.getMonth()
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7 // Пн-первый
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const isSel = (d: number) => selected && selected.getFullYear() === y && selected.getMonth() === m && selected.getDate() === d
  const shift = (delta: number) => setView(new Date(y, m + delta, 1))

  return (
    <div className="w-[15.5rem] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="rounded-md p-1 text-muted hover:text-ink" aria-label="prev">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[0.8125rem] font-semibold text-ink">{MONTHS[ru ? 'ru' : 'en'][m]} {y}</span>
        <button type="button" onClick={() => shift(1)} className="rounded-md p-1 text-muted hover:text-ink" aria-label="next">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WD[ru ? 'ru' : 'en'].map((w) => (
          <span key={w} className="py-1 text-[0.6875rem] font-medium text-muted">{w}</span>
        ))}
        {cells.map((d, i) =>
          d == null ? (
            <span key={`b${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              onClick={() => onPick(new Date(y, m, d))}
              className={`aspect-square rounded-md text-[0.78125rem] ${
                isSel(d) ? 'bg-primary font-semibold text-primary-fg' : 'text-ink hover:bg-surface-2'
              }`}
            >
              {d}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

// Первое число текущего месяца — вычисляем в обёртке, чтобы не звать new Date() в теле рендера.
function startOfThisMonth(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), 1)
}
