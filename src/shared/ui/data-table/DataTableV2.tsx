'use client'

import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { EmptyState } from '../EmptyState'
import { TEXT } from '../control'

// Таблица данных v2 (Ф11 трека ui-system; референс — devon-pro-crm, разбор в
// HQ research/2026-07-31-tables-v2-references.md). Принципы:
//  - headless TanStack + НАСТОЯЩАЯ <table>: семантика и sticky-шапка бесплатно,
//    без ручной синхронизации двух скроллов (антипример stroysnab);
//  - тонкое ядро: колонки и данные описывает вызывающий, фабрики типовых
//    колонок — в column-builders.tsx;
//  - скелетоны = pageSize строк (страница не прыгает при загрузке);
//  - мобила: горизонтальный скролл КОНТЕЙНЕРА + отключение sticky — а для
//    таблиц с cardOnMobile строки ниже md рендерятся карточками (новшество,
//    которого не было ни в одном референсе);
//  - aria-sort на сортируемых заголовках.
// DataTable v1 (div-грид, ./../DataTable.tsx) остаётся мостом для простых
// read-only списков; интерактивные админские таблицы переезжают сюда.

export type { ColumnDef }

export function DataTableV2<T>({
  columns,
  data,
  loading = false,
  skeletonRows = 8,
  empty,
  initialSorting,
  cardOnMobile = false,
  rowKey,
  className,
}: {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  /** Данные грузятся: рисуем skeletonRows строк-скелетонов вместо мигания пустотой. */
  loading?: boolean
  skeletonRows?: number
  /** Пустое состояние (EmptyState variant=inline рендерится внутри таблицы). */
  empty?: { title?: string; hint?: string }
  initialSorting?: SortingState
  /** Ниже md строки рендерятся карточками (первая колонка = заголовок карточки). */
  cardOnMobile?: boolean
  rowKey: (row: T) => string
  className?: string
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? [])
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const rows = table.getRowModel().rows
  const colCount = table.getAllLeafColumns().length

  const tableEl = (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface', cardOnMobile && 'max-md:hidden', className)}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-surface max-md:static">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort()
                const dir = h.column.getIsSorted()
                return (
                  <th
                    key={h.id}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                    className={cn('whitespace-nowrap px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-muted', TEXT.caption)}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === 'asc' && <ArrowUp size={11} />}
                        {dir === 'desc' && <ArrowDown size={11} />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {Array.from({ length: colCount }, (_, j) => (
                    <td key={j} className="px-4 py-2.5">
                      <div className="h-4 w-3/4 animate-pulse rounded-md bg-surface-2" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((r) => (
                <tr key={rowKey(r.original)} className="border-b border-border transition-colors last:border-0 hover:bg-surface-2">
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className={cn('px-4 py-2.5 align-middle', TEXT.body)}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colCount}>
                <EmptyState variant="inline" title={empty?.title} hint={empty?.hint} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  if (!cardOnMobile) return tableEl

  // Карточная мобила: первая колонка — заголовок карточки, остальные — пары
  // «подпись: значение». Тач-цели и переносы — по правилам мобильной вёрстки.
  // Сортировка на карточках — чипами (Codex #635: таблица со своими
  // заголовками-сортировками ниже md скрыта целиком).
  const [head, ...rest] = table.getAllLeafColumns()
  const sortableCols = table.getAllLeafColumns().filter((c) => c.getCanSort())
  return (
    <>
      {tableEl}
      <div className="flex flex-col gap-2 md:hidden">
        {sortableCols.length > 0 && !loading && rows.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('uppercase tracking-wide text-muted', TEXT.caption)}>⇅</span>
            {sortableCols.map((c) => {
              const dir = c.getIsSorted()
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={c.getToggleSortingHandler()}
                  className={cn(
                    'inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 pointer-coarse:min-h-11',
                    TEXT.bodySm,
                    dir ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2',
                  )}
                >
                  {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                  {dir === 'asc' && <ArrowUp size={11} />}
                  {dir === 'desc' && <ArrowDown size={11} />}
                </button>
              )
            })}
          </div>
        )}
        {loading &&
          Array.from({ length: Math.min(4, skeletonRows) }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        {!loading &&
          rows.map((r) => (
            <div key={rowKey(r.original)} className="rounded-lg border border-border bg-surface p-3">
              <div className={cn('font-medium text-ink', TEXT.body)}>
                {flexRender(head.columnDef.cell, r.getVisibleCells()[0].getContext())}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {rest.map((col, i) => (
                  <div key={col.id} className="min-w-0">
                    <dt className={cn('uppercase tracking-wide text-muted', TEXT.caption)}>
                      {typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                    </dt>
                    <dd className={cn('mt-0.5 text-ink-2 [overflow-wrap:anywhere]', TEXT.bodySm)}>
                      {flexRender(col.columnDef.cell, r.getVisibleCells()[i + 1].getContext())}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        {!loading && rows.length === 0 && <EmptyState variant="plain" title={empty?.title} hint={empty?.hint} />}
      </div>
    </>
  )
}
