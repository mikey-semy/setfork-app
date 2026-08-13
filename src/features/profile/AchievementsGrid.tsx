'use client'

import { useEffect, useState } from 'react'
import { Trophy, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'

// Одна ачивка для отображения: только заработанные и только с картинкой (картинка —
// обязательный атрибут; без неё ачивка не показывается вовсе — гейт в AchievementsCard).
export interface AchTileData {
  key: string
  label: string
  desc: string
  imageUrl: string
  tier: number
  value: number
  tiers: number[] // пороги уровней (для одноуровневых — [1])
  unit: string
}

/** Квадратные плитки-картинки (без подписей) + модалка с историей по клику. */
export function AchievementsGrid({ items, lang }: { items: AchTileData[]; lang: Lang }) {
  const ru = lang === 'ru'
  const [open, setOpen] = useState<AchTileData | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {items.map((a) => (
          <Tooltip key={a.key} label={a.tier > 1 ? `${a.label} ×${a.tier}` : a.label}>
            <button
              type="button"
              onClick={() => setOpen(a)}
              aria-label={a.label}
              className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-2 outline-hidden transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.imageUrl} alt="" className="h-full w-full object-cover" />
              {a.tier > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded-md bg-black/65 px-1 font-mono text-[0.6875rem] font-semibold leading-tight text-white">
                  ×{a.tier}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.label}
        >
          <div
            className="w-full max-w-[22.5rem] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Шапка с большой картинкой на акцентном фоне. */}
            <div className="relative flex items-center justify-center bg-linear-to-b from-(--accent-soft) to-surface py-6">
              <button
                type="button"
                onClick={() => setOpen(null)}
                aria-label={ru ? 'Закрыть' : 'Close'}
                className={buttonClass({ variant: 'ghost', size: 'sm', className: 'absolute right-2 top-2 size-7 rounded-full bg-black/40 p-0 text-white hover:bg-black/60' })}
              >
                <X size={15} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.imageUrl} alt="" className="h-24 w-24 rounded-full border-2 border-surface object-cover shadow-lg" />
            </div>

            <div className="p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[1rem] font-semibold text-ink">{open.label}</h3>
                {open.tier > 1 && (
                  <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-[0.78125rem] font-semibold text-warn">×{open.tier}</span>
                )}
              </div>
              <p className="mt-1 text-[0.8125rem] text-ink-2">{open.desc}</p>

              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-2 text-[0.78125rem] font-semibold text-ink-2">{ru ? 'История' : 'History'}</div>
                <ul className="flex flex-col gap-1.5">
                  {open.tiers.map((th, i) => {
                    const reached = open.value >= th
                    return (
                      <li key={th} className="flex items-center gap-2 text-[0.78125rem]">
                        <Trophy size={13} className={reached ? 'shrink-0 text-warn' : 'shrink-0 text-muted'} />
                        <span className={reached ? 'text-ink' : 'text-muted'}>
                          {open.tiers.length > 1 ? `${ru ? 'ур.' : 'lvl'} ${i + 1} · ` : ''}
                          {th} {open.unit}
                        </span>
                        {reached && <span className="ml-auto font-mono text-[0.6875rem] text-ok">✓</span>}
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-2 font-mono text-[0.6875rem] text-muted">
                  {ru ? 'Сейчас' : 'Now'}: {open.value} {open.unit}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
