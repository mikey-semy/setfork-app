'use client'

import { useState, useTransition } from 'react'
import { ChevronRight, Loader2, Pickaxe } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { digDeeper, type DigLayerRow } from './actions'
import { t } from '@/shared/i18n'

/**
 * «Копать глубже» под шагом (HQ §8): аккордеон слоёв + кнопка следующего слоя.
 * Один клик = один слой (остановки = бюджетный предохранитель). Выкопанное
 * хранится и видно всем — «шахта остаётся», следующий читатель идёт бесплатно.
 */
const MAX_LEVEL = 3

export function DigPanel({
  templateId,
  stepN,
  initial,
  canDig,
  lang,
}: {
  templateId: string
  stepN: number
  initial: DigLayerRow[]
  canDig: boolean
  lang: Lang
}) {
  const [layers, setLayers] = useState<DigLayerRow[]>(initial)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  const levelTitle = (lv: number) =>
    lv === 1 ? t('dig.reasonsSources', lang) : lv === 2 ? t('dig.mechanismExceptions', lang) : t('dig.finePoints', lang)

  const errText: Record<string, string> = {
    ai_off: t('dig.draftingNotConfigured', lang),
    budget: t('dig.aIBudgetExhaustedToday', lang),
    quota: t('dig.yourMonthlyAiQuota', lang),
    ratelimited: t('dig.tooFastWaitMinute', lang),
    aifail: t('dig.theDiggerCouldNot', lang),
    'not found': t('dig.stepNotFound', lang),
  }

  const dig = () => {
    setErr('')
    start(async () => {
      const res = await digDeeper(templateId, stepN, lang)
      if ('error' in res) setErr(errText[res.error] ?? res.error)
      else {
        setLayers(res.layers)
        setOpen(true)
      }
    })
  }

  if (!canDig && layers.length === 0) return null
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        {layers.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md py-0.5 text-[0.6875rem] text-muted hover:text-ink-2"
          >
            <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {t('dig.mineN', lang).replace('{n}', String(layers.length))}
          </button>
        )}
        {canDig && layers.length < MAX_LEVEL && (
          <button
            type="button"
            onClick={dig}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-ink-2 hover:border-border-strong hover:text-ink disabled:opacity-50"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Pickaxe size={12} />}
            {layers.length === 0 ? t('dig.digDeeper2', lang) : t('dig.digLowerN', lang).replace('{a}', String(layers.length)).replace('{b}', String(MAX_LEVEL))}
          </button>
        )}
        {err && <span className="text-[0.6875rem] text-warn">{err}</span>}
      </div>
      {open && layers.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {layers.map((l) => (
            <div key={l.level}>
              <div className="mb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                {t('dig.layerN', lang).replace('{n}', String(l.level))} · {levelTitle(l.level)}
              </div>
              <Markdown className="text-[0.78125rem] leading-relaxed text-ink-2">{l.content}</Markdown>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
