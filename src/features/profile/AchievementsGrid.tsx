'use client'

import { useState } from 'react'
import { Trophy, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { IconButton } from '@/shared/ui/IconButton'

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
                <span className="absolute bottom-0.5 right-0.5 rounded-md bg-black/65 px-1 font-mono text-caption font-semibold leading-tight text-white">
                  ×{a.tier}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Окно достижения — общая модальная панель: своя копия объявляла себя окном, но
          не уводила фокус внутрь и не возвращала его на плитку при закрытии, а Esc ловила
          собственным слушателем. Теперь всё это приходит от примитива. */}
      <OverlayPanel open={open !== null} onClose={() => setOpen(null)} width={0} bare className="w-full max-w-panel-xl overflow-hidden">
        {open && (
          <div>
            {/* Шапка с большой картинкой на акцентном фоне. */}
            <div className="relative flex items-center justify-center bg-linear-to-b from-accent-soft to-surface py-6">
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => setOpen(null)}
                label={ru ? 'Закрыть' : 'Close'}
                className="absolute right-2 top-2 rounded-full bg-black/40 text-white hover:bg-black/60"
              >
                <X size={15} />
              </IconButton>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.imageUrl} alt="" className="h-24 w-24 rounded-full border-2 border-surface object-cover shadow-lg" />
            </div>

            <div className="p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-title font-semibold text-ink">{open.label}</h3>
                {open.tier > 1 && (
                  <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-body-sm font-semibold text-warn">×{open.tier}</span>
                )}
              </div>
              <p className="mt-1 text-body text-ink-2">{open.desc}</p>

              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-2 text-body-sm font-semibold text-ink-2">{ru ? 'История' : 'History'}</div>
                <ul className="flex flex-col gap-1.5">
                  {open.tiers.map((th, i) => {
                    const reached = open.value >= th
                    return (
                      <li key={th} className="flex items-center gap-2 text-body-sm">
                        <Trophy size={13} className={reached ? 'shrink-0 text-warn' : 'shrink-0 text-muted'} />
                        <span className={reached ? 'text-ink' : 'text-muted'}>
                          {open.tiers.length > 1 ? `${ru ? 'ур.' : 'lvl'} ${i + 1} · ` : ''}
                          {th} {open.unit}
                        </span>
                        {reached && <span className="ml-auto font-mono text-caption text-ok">✓</span>}
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-2 font-mono text-caption text-muted">
                  {ru ? 'Сейчас' : 'Now'}: {open.value} {open.unit}
                </div>
              </div>
            </div>
          </div>
        )}
      </OverlayPanel>
    </>
  )
}
