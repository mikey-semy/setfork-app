'use client'

import { Badge } from '@/shared/ui/badge'
import { DataTableV2, type ColumnDef } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn } from '@/shared/ui/data-table/column-builders'
import { tr, type Lang } from '@/shared/i18n'

/**
 * Щиток надёжности моделей (/admin/usage) — DataTableV2 (Ф11, хвост миграции с v1-моста).
 * Титульная полоса и внешняя рамка остаются у серверной страницы, поэтому таблица
 * здесь без своей рамки (rounded-none border-0) — как было у v1. Карточная мобила
 * НЕ включена: панель живёт внутри рамки с заголовком, карточки внутри рамки дали бы
 * двойную обводку — на мобиле скроллится контейнер таблицы, страница — никогда.
 * Строки приходят с сервера готовыми и отсортированными (худший success первым).
 */
export interface UsageModelRow {
  /** Сырой id модели — ключ строки и title (полное имя по ховеру). */
  model: string
  /** Читаемое имя (prettyModelName) — посчитано на сервере. */
  name: string
  calls: number
  okRate: number
  p95Ms: number | null
  quarantined: boolean
}

const num = (n: number) => new Intl.NumberFormat('en').format(n)

export function UsageModelsTable({ rows, lang }: { rows: UsageModelRow[]; lang: Lang }) {
  const columns: ColumnDef<UsageModelRow, unknown>[] = [
    nodeColumn<UsageModelRow>({
      id: 'model',
      header: tr({ en: 'Model', ru: 'Модель' }, lang),
      render: (r) => (
        <span className="block min-w-0 truncate font-mono text-[0.78125rem] text-ink" title={r.model}>
          {r.name}
        </span>
      ),
    }),
    numberColumn<UsageModelRow>({ id: 'calls', header: tr({ en: 'Calls', ru: 'Вызовы' }, lang), size: 96, value: (r) => r.calls, format: num }),
    {
      id: 'okRate',
      header: tr({ en: 'Success', ru: 'Успех' }, lang),
      size: 104,
      enableSorting: true,
      accessorFn: (r) => r.okRate,
      cell: ({ row }) => {
        const r = row.original
        return (
          <span
            className={`block text-right font-mono tabular-nums text-[0.8125rem] font-semibold ${r.okRate >= 0.95 ? 'text-ok' : r.okRate >= 0.9 ? 'text-warn' : 'text-danger'}`}
          >
            {(r.okRate * 100).toFixed(1)}%
          </span>
        )
      },
    },
    numberColumn<UsageModelRow>({ id: 'p95', header: 'p95', size: 88, value: (r) => r.p95Ms, format: (n) => `${(n / 1000).toFixed(1)}s` }),
    nodeColumn<UsageModelRow>({
      id: 'status',
      header: tr({ en: 'Status', ru: 'Статус' }, lang),
      size: 128,
      render: (r) => (
        <span className="block text-right">
          {r.quarantined ? (
            <Badge variant="danger">{tr({ en: 'quarantine', ru: 'карантин' }, lang)}</Badge>
          ) : (
            <span className="text-[0.6875rem] text-muted">{tr({ en: 'in rotation', ru: 'в ротации' }, lang)}</span>
          )}
        </span>
      ),
    }),
  ]
  return <DataTableV2<UsageModelRow> rowKey={(r) => r.model} columns={columns} data={rows} className="rounded-none border-0" />
}
