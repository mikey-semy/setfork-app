'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import type { WatchEvents, WatchLevel, WatchState } from '@/core'
import { setWatch } from './actions'

export interface WatchLabels {
  watch: string
  unwatch: string
  title: string
  participating: string
  participatingDesc: string
  all: string
  allDesc: string
  ignore: string
  ignoreDesc: string
  custom: string
  customDesc: string
  customTitle: string
  evVersions: string
  evIssues: string
  evSuggestions: string
  apply: string
}

const EVENT_KEYS = ['versions', 'issues', 'suggestions'] as const

/** Watch как на GitHub: кнопка-триггер с дропдауном уровней подписки
 *  (Participating & @mentions / All activity / Ignore / Custom). Custom открывает
 *  панель с выбором событий (Версии/Задачи/Предложения). */
export function WatchButton({
  templateId,
  state,
  count,
  labels,
}: {
  templateId: string
  state: WatchState
  count: number
  labels: WatchLabels
}) {
  const [pending, start] = useTransition()
  const [level, setLevel] = useState<WatchLevel>(state.level)
  const [events, setEvents] = useState<WatchEvents>(state.events ?? {})
  const [count_, setCount] = useState(count)
  const [customOpen, setCustomOpen] = useState(false)

  const watching = level === 'all' || level === 'custom'

  function apply(next: WatchLevel, evs?: WatchEvents) {
    const nowWatching = next === 'all' || next === 'custom'
    if (watching !== nowWatching) setCount((c) => Math.max(0, c + (nowWatching ? 1 : -1)))
    setLevel(next)
    start(async () => {
      await setWatch(templateId, next, evs)
    })
  }

  const rows: { key: Exclude<WatchLevel, 'custom'>; title: string; desc: string }[] = [
    { key: 'participating', title: labels.participating, desc: labels.participatingDesc },
    { key: 'all', title: labels.all, desc: labels.allDesc },
    { key: 'ignore', title: labels.ignore, desc: labels.ignoreDesc },
  ]

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={watching ? labels.unwatch : labels.watch}
            title={watching ? labels.unwatch : labels.watch}
            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors max-sm:gap-1.5 max-sm:px-2.5 max-sm:py-1.5 ${
              watching ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink hover:border-border-strong'
            }`}
          >
            {watching ? <EyeOff size={14} /> : <Eye size={14} />}
            {/* Мобила: только глаз+счётчик (текст не влезал рядом с Pin — скилл mobile-ui). */}
            <span className="hidden sm:inline">{watching ? labels.unwatch : labels.watch}</span>
            <span className="font-mono text-[12px] text-muted">{count_}</span>
            <ChevronDown size={13} className="text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[330px] p-0">
          <div className="border-b border-border px-3 py-2.5 text-[13px] font-semibold text-ink">{labels.title}</div>
          {rows.map((r) => (
            <DropdownMenuItem key={r.key} onSelect={() => apply(r.key)} className="flex items-start gap-2 px-3 py-2.5">
              <span className="mt-0.5 w-4 shrink-0">{level === r.key && <Check size={14} className="text-accent" />}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{r.title}</span>
                <span className="block text-[12px] leading-snug text-muted">{r.desc}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setCustomOpen(true)} className="flex items-start gap-2 border-t border-border px-3 py-2.5">
            <span className="mt-0.5 w-4 shrink-0">{level === 'custom' && <Check size={14} className="text-accent" />}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{labels.custom}</span>
              <span className="block text-[12px] leading-snug text-muted">{labels.customDesc}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <OverlayPanel open={customOpen} onClose={() => setCustomOpen(false)} title={labels.customTitle} width={360}>
        <div className="flex flex-col gap-1 px-3.5 py-3">
          {EVENT_KEYS.map((k) => {
            const label = k === 'versions' ? labels.evVersions : k === 'issues' ? labels.evIssues : labels.evSuggestions
            return (
              <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={!!events[k]}
                  onChange={(e) => setEvents((prev) => ({ ...prev, [k]: e.target.checked }))}
                  className="size-4 accent-(--accent)"
                />
                <span className="text-[13px] text-ink">{label}</span>
              </label>
            )
          })}
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => {
                apply('custom', events)
                setCustomOpen(false)
              }}
              disabled={pending}
              className="rounded-md border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {labels.apply}
            </button>
          </div>
        </div>
      </OverlayPanel>
    </>
  )
}
