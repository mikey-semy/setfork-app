'use client'

import { Pause, Play } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { DataTableV2, type ColumnDef } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn } from '@/shared/ui/data-table/column-builders'
import { t, tr, type Lang } from '@/shared/i18n'
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
      header: t('admin.loop', lang),
      render: (r) => <span className="block min-w-0 truncate font-mono text-body-sm text-ink">{r.type}</span>,
    }),
    nodeColumn<LoopRow>({
      id: 'state',
      header: t('admin.state', lang),
      size: 112,
      render: (r) => (
        <span className={`block text-right text-body-sm ${r.circuitTripped ? 'text-danger' : r.paused ? 'text-warn' : 'text-ok'}`}>
          {r.circuitTripped
            ? t('admin.breakerTripped', lang)
            : r.paused
              ? t('admin.paused', lang)
              : t('admin.running', lang)}
        </span>
      ),
    }),
    nodeColumn<LoopRow>({
      id: 'dryRun',
      header: t('admin.dryRun', lang),
      size: 112,
      render: (r) => (
        <form action={toggleLoopDryRun} className="text-right">
          <input type="hidden" name="type" value={r.type} />
          <input type="hidden" name="dryRun" value={String(r.dryRun)} />
          <Button type="submit" size="md">
            {r.dryRun ? t('admin.on', lang) : t('admin.off2', lang)}
          </Button>
        </form>
      ),
    }),
    nodeColumn<LoopRow>({
      id: 'switch',
      header: t('admin.switch', lang),
      size: 112,
      render: (r) => (
        // flex-wrap: в карточной мобиле «Сбросить» + «Пустить» стоят в половине ширины карточки.
        <div className="flex flex-wrap items-center justify-end gap-3">
          {r.circuitTripped && (
            <form action={resetLoopCircuit}>
              <input type="hidden" name="type" value={r.type} />
              <Button type="submit" variant="danger" size="md">
                {t('admin.reset', lang)}
              </Button>
            </form>
          )}
          <form action={toggleLoopPause}>
            <input type="hidden" name="type" value={r.type} />
            <input type="hidden" name="paused" value={String(r.paused)} />
            <Button type="submit" size="md">
              {r.paused ? <Play size={13} /> : <Pause size={13} />}
              {r.paused ? t('admin.resume', lang) : t('admin.pause', lang)}
            </Button>
          </form>
        </div>
      ),
    }),
  ]
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <DataTableV2<LoopRow> cardOnMobile rowKey={(r) => r.type} columns={columns} data={rows} />
      <p className="text-caption text-muted">
        {t('admin.pauseStopsQueueFrom', lang)}
      </p>
    </div>
  )
}
