'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Plus, RotateCw } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'
import { MAX_VARIANTS } from './limits'
import { t } from '@/shared/i18n'

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
  const canRegen = !working && candidates.length < MAX_VARIANTS

  const jump = (c: GenerationCandidate) => {
    onPick(c.id)
    setOpen(false)
    document.getElementById(`cand-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div ref={ref} className="relative shrink-0">
      {/* «+» ВНУТРИ поля (как у ChatGPT/Claude, фидбек владельца). Кликабелен ВСЕГДА:
          disabled-кнопка «нажимаю и ничего» ставила в тупик — теперь до первого варианта
          меню честно объясняет, что появится здесь. Тултип — shadcn, не браузерный title. */}
      <Tooltip label={t('generation.variantActions', lang)}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('generation.variantActions', lang)}
          onClick={() => setOpen((v) => !v)}
          className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Plus size={18} className={`transition-transform ${open ? 'rotate-45' : ''}`} />
        </button>
      </Tooltip>

      {open && candidates.length === 0 && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[16.25rem] rounded-md border border-border bg-surface px-3 py-2.5 text-body-sm leading-relaxed text-muted shadow-card">
          {t('generation.variantActionsWillAppear', lang)}
        </div>
      )}

      {open && candidates.length > 0 && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[18.75rem] overflow-hidden rounded-md border border-border bg-surface shadow-card">
          <button
            type="button"
            disabled={!canAccept}
            onClick={() => {
              setOpen(false)
              onAccept()
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-body font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
          >
            <Check size={14} className="shrink-0 text-accent" />
            <span className="min-w-0">
              {t('generation.useOne', lang)}
              {selected && <span className="block truncate text-caption font-normal text-muted">{selected.title}</span>}
            </span>
          </button>
          <button
            type="button"
            disabled={!canRegen}
            onClick={() => {
              setOpen(false)
              onRegen()
            }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-body text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <RotateCw size={14} className="shrink-0" />
            {t('generation.anotherVariant', lang)}{' '}
            <span className="ml-auto text-caption tabular-nums text-muted">
              {candidates.length}/{MAX_VARIANTS}
            </span>
          </button>
          {candidates.length > 1 && (
            <div className="border-t border-border">
              <div className="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-muted">
                {t('generation.variants', lang)}
              </div>
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => jump(c)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2 ${c.id === selId ? 'bg-surface-2' : ''}`}
                >
                  <span className="mt-px shrink-0 text-caption tabular-nums text-muted">{c.idx}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm text-ink">{c.title}</span>
                    {c.summary && <span className="mt-0.5 block truncate text-caption text-muted">{c.summary}</span>}
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
