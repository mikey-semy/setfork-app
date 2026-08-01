'use client'

import { Check, X } from 'lucide-react'
import { DataTableV2, type ColumnDef } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn } from '@/shared/ui/data-table/column-builders'
import { tr, type Lang } from '@/shared/i18n'
import { decideAgendaItem } from '@/features/admin/agenda-actions'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * Повестка развития (/admin/development) — DataTableV2 (Ф11, хвост миграции с v1-моста).
 * На мобиле строки — карточки: у v1 таблица требовала 720px и кнопки решения уезжали
 * за край экрана, в карточке «Одобрить/Отклонить» под большим пальцем. Приоритет сортируется.
 * Пункт предлагает петля, решает человек — поэтому решение живёт прямо в строке.
 */
export interface AgendaRow {
  id: string
  /** Готовая подпись (agendaLabel) — посчитана на сервере. */
  label: string
  /** Числа как есть, строкой k=v · k=v: «списков 1 при пороге 5» проверяемо, «усилить направление» — нет. */
  why: string
  score: number
  status: string
  ownerExpertId: string | null
}

export function DevAgendaTable({ rows, lang }: { rows: AgendaRow[]; lang: Lang }) {
  const columns: ColumnDef<AgendaRow, unknown>[] = [
    nodeColumn<AgendaRow>({
      id: 'what',
      header: tr({ en: 'What to grow', ru: 'Что растим' }, lang),
      render: (r) => <span className="block min-w-0 truncate text-[0.8125rem] text-ink">{r.label}</span>,
    }),
    nodeColumn<AgendaRow>({
      id: 'why',
      header: tr({ en: 'Why (numbers)', ru: 'Почему (числа)' }, lang),
      render: (r) => <span className="block min-w-0 truncate font-mono text-[0.6875rem] text-ink-2">{r.why}</span>,
    }),
    numberColumn<AgendaRow>({ id: 'score', header: tr({ en: 'Priority', ru: 'Приоритет' }, lang), size: 96, value: (r) => r.score, format: (n) => n.toFixed(2) }),
    nodeColumn<AgendaRow>({
      id: 'decision',
      header: tr({ en: 'Decision', ru: 'Решение' }, lang),
      size: 128,
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5">
          {r.status === 'proposed' ? (
            <>
              <form action={decideAgendaItem}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="decision" value="approved" />
                <Tooltip label={tr({ en: 'Approve', ru: 'Одобрить' }, lang)}>
                  <button type="submit" aria-label={tr({ en: 'Approve', ru: 'Одобрить' }, lang)} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ok">
                    <Check size={16} />
                  </button>
                </Tooltip>
              </form>
              <form action={decideAgendaItem}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="decision" value="dismissed" />
                <Tooltip label={tr({ en: 'Dismiss', ru: 'Отклонить' }, lang)}>
                  <button type="submit" aria-label={tr({ en: 'Dismiss', ru: 'Отклонить' }, lang)} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-warn">
                    <X size={16} />
                  </button>
                </Tooltip>
              </form>
            </>
          ) : (
            <Tooltip label={r.ownerExpertId ?? ''}>
              <span className={`text-[0.78125rem] ${r.status === 'approved' ? 'text-ok' : 'text-muted'}`}>
                {r.status === 'approved' ? tr({ en: 'approved', ru: 'одобрено' }, lang) : tr({ en: 'dismissed', ru: 'отклонено' }, lang)}
              </span>
            </Tooltip>
          )}
        </div>
      ),
    }),
  ]
  return <DataTableV2<AgendaRow> cardOnMobile rowKey={(r) => r.id} columns={columns} data={rows} />
}
