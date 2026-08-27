'use client'

import { DataTableV2, type ColumnDef } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn } from '@/shared/ui/data-table/column-builders'
import { UserLine } from '@/shared/ui/UserLine'
import { t, tr, type Lang } from '@/shared/i18n'

/**
 * Расход по пользователям (/admin/usage) — DataTableV2 (Ф11, хвост миграции с v1-моста).
 * На мобиле строки — карточки (заголовок карточки = пользователь): числовых колонок три,
 * и таблица со скроллом прятала бы деньги за краем экрана. Числа сортируются.
 */
export interface UsageUserRow {
  userId: string | null
  handle: string | null
  calls: number
  totalTokens: number
  costUsd: number
}

const NUM_FMT = new Intl.NumberFormat('en') // модульный уровень: пересборка форматтера на каждый вызов дорога (react-doctor)
const num = (n: number) => NUM_FMT.format(n)
const money = (n: number) => '$' + n.toFixed(n < 1 ? 4 : 2)

export function UsageByUserTable({ rows, lang }: { rows: UsageUserRow[]; lang: Lang }) {
  const columns: ColumnDef<UsageUserRow, unknown>[] = [
    nodeColumn<UsageUserRow>({
      id: 'user',
      header: t('admin.user', lang),
      render: (r) =>
        r.handle ? (
          <UserLine handle={r.handle} size="md" className="min-w-0" />
        ) : (
          <span className="text-body text-muted">{t('admin.systemDeleted', lang)}</span>
        ),
    }),
    numberColumn<UsageUserRow>({ id: 'calls', header: t('admin.calls2', lang), size: 112, value: (r) => r.calls, format: num }),
    numberColumn<UsageUserRow>({ id: 'tokens', header: t('admin.tokens2', lang), size: 112, value: (r) => r.totalTokens, format: num }),
    {
      id: 'cost',
      header: t('admin.cost', lang),
      size: 112,
      enableSorting: true,
      accessorFn: (r) => r.costUsd,
      // Деньги полужирным — как в v1: это главная колонка таблицы.
      cell: ({ row }) => (
        <span className="block text-right font-mono tabular-nums text-body font-semibold text-ink">{money(row.original.costUsd)}</span>
      ),
    },
  ]
  return (
    <DataTableV2<UsageUserRow>
      cardOnMobile
      rowKey={(r) => r.userId ?? 'system'}
      columns={columns}
      data={rows}
      empty={{ hint: t('admin.noUsageYet', lang) }}
    />
  )
}
