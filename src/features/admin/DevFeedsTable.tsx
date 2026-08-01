'use client'

import Link from 'next/link'
import { DataTableV2, type ColumnDef } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn } from '@/shared/ui/data-table/column-builders'
import { t, tr, type Lang } from '@/shared/i18n'

/**
 * Живые списки (/admin/development) — DataTableV2 (Ф11, хвост миграции с v1-моста).
 * Шесть колонок и 720px мин-ширины в v1 на мобиле прятали половину чисел за краем —
 * здесь ниже md строки становятся карточками. Числовые колонки сортируются: вопрос
 * секции — «какая лента оправдывает расход» — это и есть сортировка по просмотрам/правкам.
 */
export interface FeedRow {
  id: string
  href: string
  title: string
  freshestAgeDays: number | null
  grown: number
  views: number
  clicks: number
  humanEdits: number
}

const NUM_FMT = new Intl.NumberFormat('en') // модульный уровень: пересборка форматтера на каждый вызов дорога (react-doctor)
const num = (n: number) => NUM_FMT.format(n)

export function DevFeedsTable({ rows, lang }: { rows: FeedRow[]; lang: Lang }) {
  const columns: ColumnDef<FeedRow, unknown>[] = [
    nodeColumn<FeedRow>({
      id: 'feed',
      header: t('admin.feed', lang),
      render: (r) => (
        <Link href={r.href} className="block min-w-0 truncate text-[0.8125rem] text-ink hover:text-accent" title={r.title}>
          {r.title}
        </Link>
      ),
    }),
    {
      id: 'fresh',
      header: t('admin.fresh2', lang),
      size: 92,
      enableSorting: true,
      // Неизвестная свежесть сортируется как самая старая — «—» не притворяется свежим.
      accessorFn: (r) => r.freshestAgeDays ?? Number.MAX_SAFE_INTEGER,
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className={`block text-right font-mono tabular-nums text-[0.78125rem] ${r.freshestAgeDays == null ? 'text-muted' : r.freshestAgeDays > 7 ? 'text-warn' : 'text-ok'}`}>
            {r.freshestAgeDays == null ? '—' : tr({ en: `${r.freshestAgeDays}d`, ru: `${r.freshestAgeDays} дн.` }, lang)}
          </span>
        )
      },
    },
    numberColumn<FeedRow>({ id: 'grown', header: t('admin.grown', lang), size: 84, value: (r) => r.grown, format: num }),
    numberColumn<FeedRow>({ id: 'views', header: t('admin.views', lang), size: 104, value: (r) => r.views, format: num }),
    numberColumn<FeedRow>({ id: 'clicks', header: t('admin.sourceClicks', lang), size: 88, value: (r) => r.clicks, format: num }),
    {
      id: 'humanEdits',
      header: t('admin.humanEdits', lang),
      size: 112,
      enableSorting: true,
      accessorFn: (r) => r.humanEdits,
      // Правки людей выделены: это единственная цифра здесь, которую нельзя получить,
      // потратив свои же деньги.
      cell: ({ row }) => (
        <span className={`block text-right font-mono tabular-nums text-[0.78125rem] ${row.original.humanEdits > 0 ? 'text-ok' : 'text-muted'}`}>
          {num(row.original.humanEdits)}
        </span>
      ),
    },
  ]
  return <DataTableV2<FeedRow> cardOnMobile rowKey={(r) => r.id} columns={columns} data={rows} />
}
