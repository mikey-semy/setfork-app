'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronUp, RotateCw } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'

/**
 * Меню действий у поля ввода (фидбек владельца): «Использовать этот» и «Ещё
 * вариант» жили в липком баре НАВЕРХУ — к ним приходилось скроллить от поля
 * ввода. Теперь — выпадающее ВВЕРХ меню слева от поля, туда же уехал прыжок
 * по вариантам. Паттерн дропдауна ручной, как VariantJump (клик-вне + Escape).
 */
export function ActionsMenu({
  candidates,
  selId,
  working,
  lang,
  onPick,
  onAccept,
  onRegen,
}: {
  candidates: GenerationCandidate[]
  selId?: string
  working: boolean
  lang: Lang
  onPick: (id: string) => void
  onAccept: () => void
  onRegen: () => void
}) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = candidates.find((c) => c.id === selId)
  const canAccept = !!selId && !working
  const canRegen = !working && candidates.length < 6

  const jump = (c: GenerationCandidate) => {
    onPick(c.id)
    setOpen(false)
    document.getElementById(`cand-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={say('Variant actions', 'Действия с вариантами')}
        disabled={candidates.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="grid size-[42px] place-items-center rounded-full border border-border text-ink-2 hover:border-border-strong hover:text-ink disabled:opacity-40"
      >
        <ChevronUp size={17} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[300px] overflow-hidden rounded-md border border-border bg-surface shadow-card">
          <button
            type="button"
            disabled={!canAccept}
            onClick={() => {
              setOpen(false)
              onAccept()
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
          >
            <Check size={14} className="shrink-0 text-accent" />
            <span className="min-w-0">
              {say('Use this one', 'Использовать этот')}
              {selected && <span className="block truncate text-[11.5px] font-normal text-muted">{selected.title}</span>}
            </span>
          </button>
          <button
            type="button"
            disabled={!canRegen}
            onClick={() => {
              setOpen(false)
              onRegen()
            }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <RotateCw size={14} className="shrink-0" />
            {say('Another variant', 'Ещё вариант')} <span className="ml-auto text-[11px] tabular-nums text-muted">{candidates.length}/6</span>
          </button>
          {candidates.length > 1 && (
            <div className="border-t border-border">
              <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                {say('Variants', 'Варианты')}
              </div>
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => jump(c)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2 ${c.id === selId ? 'bg-surface-2' : ''}`}
                >
                  <span className="mt-px shrink-0 text-[11px] tabular-nums text-muted">{c.idx}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-ink">{c.title}</span>
                    {c.summary && <span className="mt-0.5 block truncate text-[11px] text-muted">{c.summary}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
