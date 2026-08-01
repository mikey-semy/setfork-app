'use client'

import { Pause, Play } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { DataTableV2, type ColumnDef } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn } from '@/shared/ui/data-table/column-builders'
import { tr, type Lang } from '@/shared/i18n'
import { resetLoopCircuit, toggleLoopDryRun, toggleLoopPause } from '@/features/admin/actions'

/**
 * Автономные петли (/admin/development) — DataTableV2 (Ф11, хвост миграции с v1-моста).
 * Это рубильники: на мобиле строки — карточки, чтобы кнопки «Стоп/Пустить/Сбросить»
 * были под пальцем, а не за горизонтальным скроллом (в v1 таблица требовала 560px).
 * Пояснение про предохранитель — под таблицей: у v2 нет слота футера внутри рамки.
 */
export interface LoopRow {
  type: string
  paused: boolean
  dryRun: boolean
  circuitTripped: boolean
}

export function DevLoopsTable({ rows, lang }: { rows: LoopRow[]; lang: Lang }) {
  const columns: ColumnDef<LoopRow, unknown>[] = [
    nodeColumn<LoopRow>({
      id: 'loop',
      header: tr({ en: 'Loop', ru: 'Петля' }, lang),
      render: (r) => <span className="block min-w-0 truncate font-mono text-[0.78125rem] text-ink">{r.type}</span>,
    }),
    nodeColumn<LoopRow>({
      id: 'state',
      header: tr({ en: 'State', ru: 'Состояние' }, lang),
      size: 112,
      render: (r) => (
        <span className={`block text-right text-[0.78125rem] ${r.circuitTripped ? 'text-danger' : r.paused ? 'text-warn' : 'text-ok'}`}>
          {r.circuitTripped
            ? tr({ en: 'breaker tripped', ru: 'предохранитель' }, lang)
            : r.paused
              ? tr({ en: 'paused', ru: 'остановлена' }, lang)
              : tr({ en: 'running', ru: 'работает' }, lang)}
        </span>
      ),
    }),
    nodeColumn<LoopRow>({
      id: 'dryRun',
      header: tr({ en: 'Dry run', ru: 'Сухой прогон' }, lang),
      size: 112,
      render: (r) => (
        <form action={toggleLoopDryRun} className="text-right">
          <input type="hidden" name="type" value={r.type} />
          <input type="hidden" name="dryRun" value={String(r.dryRun)} />
          <Button type="submit" size="md">
            {r.dryRun ? tr({ en: 'on', ru: 'вкл' }, lang) : tr({ en: 'off', ru: 'выкл' }, lang)}
          </Button>
        </form>
      ),
    }),
    nodeColumn<LoopRow>({
      id: 'switch',
      header: tr({ en: 'Switch', ru: 'Рубильник' }, lang),
      size: 112,
      render: (r) => (
        // flex-wrap: в карточной мобиле «Сбросить» + «Пустить» стоят в половине ширины карточки.
        <div className="flex flex-wrap items-center justify-end gap-2">
          {r.circuitTripped && (
            <form action={resetLoopCircuit}>
              <input type="hidden" name="type" value={r.type} />
              <Button type="submit" variant="danger" size="md">
                {tr({ en: 'Reset', ru: 'Сбросить' }, lang)}
              </Button>
            </form>
          )}
          <form action={toggleLoopPause}>
            <input type="hidden" name="type" value={r.type} />
            <input type="hidden" name="paused" value={String(r.paused)} />
            <Button type="submit" size="md">
              {r.paused ? <Play size={13} /> : <Pause size={13} />}
              {r.paused ? tr({ en: 'Resume', ru: 'Пустить' }, lang) : tr({ en: 'Pause', ru: 'Стоп' }, lang)}
            </Button>
          </form>
        </div>
      ),
    }),
  ]
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <DataTableV2<LoopRow> cardOnMobile rowKey={(r) => r.type} columns={columns} data={rows} />
      <p className="text-[0.6875rem] text-muted">
        {tr(
          {
            en: 'Pause stops the queue from handing out this loop’s jobs — atomically, on every instance, without a restart. The breaker is tripped by code and cleared by a human.',
            ru: 'Стоп прекращает выдачу задач этой петли — атомарно, на всех инстансах, без рестарта. Предохранитель ставит код, снимает человек.',
          },
          lang,
        )}
      </p>
    </div>
  )
}
