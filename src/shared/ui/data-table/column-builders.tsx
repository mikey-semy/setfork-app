import type { ColumnDef } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { TEXT } from '../control'

// Фабрики типовых колонок (Ф11; идея из devon-pro-crm column-builders —
// «самая недооценённая вещь»: убирают копипасту и дают единый вид дат/чисел/
// статусов, включая честное «—» для пустых значений).

/** Текстовая колонка: значение или «—». */
export function textColumn<T>(opts: {
  id: string
  header: string
  value: (row: T) => string | null | undefined
  size?: number
  mono?: boolean
  sortable?: boolean
}): ColumnDef<T, unknown> {
  return {
    id: opts.id,
    header: opts.header,
    size: opts.size,
    enableSorting: opts.sortable ?? false,
    accessorFn: (row) => opts.value(row) ?? '',
    cell: ({ row }) => {
      const v = opts.value(row.original)
      return v ? <span className={cn('text-ink', opts.mono && cn('font-mono', TEXT.bodySm))}>{v}</span> : <span className="text-muted">—</span>
    },
  }
}

/** Числовая колонка: моно, выравнивание вправо, сортировка по умолчанию. */
export function numberColumn<T>(opts: {
  id: string
  header: string
  value: (row: T) => number | null | undefined
  size?: number
  format?: (n: number) => string
}): ColumnDef<T, unknown> {
  return {
    id: opts.id,
    header: opts.header,
    size: opts.size ?? 96,
    enableSorting: true,
    accessorFn: (row) => opts.value(row) ?? -Infinity,
    cell: ({ row }) => {
      const v = opts.value(row.original)
      return (
        <span className={cn('block text-right font-mono tabular-nums text-ink', TEXT.bodySm)}>
          {v == null ? '—' : (opts.format ? opts.format(v) : String(v))}
        </span>
      )
    },
  }
}

/** Дата-колонка: значение форматирует вызывающий (timeAgo/локаль — у него). */
export function dateColumn<T>(opts: {
  id: string
  header: string
  value: (row: T) => Date | string | null | undefined
  render: (v: Date | string) => string
  size?: number
}): ColumnDef<T, unknown> {
  return {
    id: opts.id,
    header: opts.header,
    size: opts.size ?? 120,
    enableSorting: true,
    accessorFn: (row) => {
      const v = opts.value(row)
      return v ? new Date(v).getTime() : 0
    },
    cell: ({ row }) => {
      const v = opts.value(row.original)
      return v ? <span className={cn('text-ink-2', TEXT.bodySm)}>{opts.render(v)}</span> : <span className="text-muted">—</span>
    },
  }
}

/** Произвольная колонка-рендер (аватары, бейджи, действия). */
export function nodeColumn<T>(opts: {
  id: string
  header: string
  render: (row: T) => ReactNode
  size?: number
}): ColumnDef<T, unknown> {
  return {
    id: opts.id,
    header: opts.header,
    size: opts.size,
    enableSorting: false,
    cell: ({ row }) => opts.render(row.original),
  }
}
