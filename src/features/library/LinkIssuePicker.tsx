'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { Tooltip } from '@/shared/ui/Tooltip'
import { toggleClosingRef } from './suggestion-meta-actions'

/**
 * Привязка задачи к предложению — аналог раздела Development у GitHub («слияние
 * этой правки закроет эти задачи»).
 *
 * Связь хранится ТАМ ЖЕ, где и была: строкой `closes #N` в тексте предложения.
 * Отдельная таблица дала бы второй источник правды, и связь, набранная руками в
 * тексте, разошлась бы со связью из пикера. Здесь пикер просто дописывает и
 * убирает ту же строку — и авто-закрытие при слиянии работает без изменений.
 */
export function LinkIssuePicker({
  suggestionId,
  issues,
  linked,
  canEdit,
  labels,
}: {
  suggestionId: string
  /** Открытые задачи списка — из чего выбирать. */
  issues: { number: number; title: string }[]
  /** Уже привязанные номера (разобранные из текста). */
  linked: number[]
  canEdit: boolean
  labels: { add: string; empty: string; filter: string; remove: string; hint: string; clear: string }
}) {
  const [q, setQ] = useState('')
  const [pending, start] = useTransition()
  const toggle = (n: number) => start(async () => void (await toggleClosingRef(suggestionId, n)))

  const free = issues.filter((i) => !linked.includes(i.number))
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? free.filter((i) => i.title.toLowerCase().includes(needle) || String(i.number).includes(needle))
    : free

  return (
    <div className="flex flex-col gap-1.5">
      {linked.length === 0 && <p className="text-[0.78125rem] text-muted">{labels.empty}</p>}

      {canEdit && (
        <Popover>
          <PopoverTrigger asChild>
            {/* Служебное действие — компактной кнопкой, тач-цель по высоте 38px
                как у остальных кнопок панели. */}
            <Button variant="ghost" className="h-7 w-full justify-start px-2 text-[0.78125rem]" disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {labels.add}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[16.25rem] overflow-hidden p-0">
            {/* Заголовок = тексту кнопки-триггера; крестика нет намеренно: Popover
                (Radix) сам закрывается по Esc/клику мимо, а первым фокусируемым
                элементом остаётся поле поиска — как было с Input. */}
            <PickerPanel
              title={labels.add}
              search={{ value: q, onChange: setQ, placeholder: labels.filter, clearLabel: labels.clear }}
            >
              {shown.length === 0 ? (
                <p className="px-2 py-3 text-[0.78125rem] text-muted">{labels.empty}</p>
              ) : (
                shown.slice(0, 30).map((i) => (
                  <PickerRow
                    key={i.number}
                    onClick={() => toggle(i.number)}
                    icon={<span className="shrink-0 font-mono text-muted">#{i.number}</span>}
                    label={i.title}
                  />
                ))
              )}
            </PickerPanel>
          </PopoverContent>
        </Popover>
      )}

      {canEdit && linked.length > 0 && (
        <div className="flex flex-col gap-1">
          {linked.map((n) => (
            <div key={n} className="flex items-center gap-1.5 text-[0.78125rem]">
              <span className="font-mono text-muted">#{n}</span>
              <Tooltip label={labels.remove}>
                <button
                  type="button"
                  onClick={() => toggle(n)}
                  aria-label={labels.remove}
                  disabled={pending}
                  className="ml-auto grid size-9 shrink-0 place-items-center rounded-md text-muted hover:text-ink"
                >
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      <p className="text-[0.6875rem] text-muted">{labels.hint}</p>
    </div>
  )
}
