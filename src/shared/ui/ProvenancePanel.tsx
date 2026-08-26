'use client'

import { useState } from 'react'
import { ChevronRight, ScrollText } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { prettyModelName } from '@/shared/ai/model-names'
import { t } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'

/**
 * «Как собран список» (HQ §6, объяснимость): прозрачность мастерской — какие
 * гномы участвовали, на какие похожие списки опирались, какие правила ремесла
 * держали и что сказал критик. Данные из provenance (#358) копятся на каждом
 * витке. Раньше называлось «Родословная» и показывало id гнома + модель — было
 * непонятно (фидбек владельца «что такое Ковали?»): теперь имена и вводная строка.
 */

interface Prov {
  depth?: string
  provider?: string
  experts?: { id: string; model: string; precedents?: string[] }[]
  precedents?: { title: string }[]
  precedentSteps?: string[]
  craftRules?: string[]
  noBasis?: string[]
  critique?: string
  models?: Record<string, string>
}

export function ProvenancePanel({ provenance, gnomeNames, lang }: { provenance: Record<string, unknown>; gnomeNames?: Record<string, string>; lang: Lang }) {
  const [open, setOpen] = useState(false)
  const p = provenance as Prov
  const hasAny = Boolean(p.experts?.length || p.precedents?.length || p.craftRules?.length || p.noBasis?.length || p.critique || p.depth)
  if (!hasAny) return null
  const nameOf = (id: string) => gnomeNames?.[id] || id.charAt(0).toUpperCase() + id.slice(1)

  const row = (label: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <span className="font-semibold text-ink-2">{label}:</span> <span className="text-muted">{items.join(' · ')}</span>
      </div>
    )

  return (
    <div className="mt-1 pl-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass({ variant: 'ghost', className: 'hover:text-ink-2' })}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <ScrollText size={11} /> {t('ui.howListWasBuilt', lang)}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3 text-caption leading-relaxed">
          <p className="text-muted">
            {t('ui.transparencyWorkshopWhoTook', lang)}
          </p>
          {p.experts && p.experts.length > 0 && (
            <div>
              {/* Имя гнома — крупно, модель (его «инструмент») — мелко и в скобках. */}
              <span className="font-semibold text-ink-2">{t('ui.assembledBy', lang)}:</span>{' '}
              <span className="text-muted">
                {p.experts.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ' · '}
                    {nameOf(e.id)} <span className="text-caption opacity-70">({prettyModelName(e.model)})</span>
                  </span>
                ))}
              </span>
            </div>
          )}
          {row(t('ui.leanedSimilarLists', lang), (p.precedents ?? []).map((x) => x.title))}
          {row(t('ui.craftRulesHeld', lang), p.craftRules ?? [])}
          {/* ГДЕ НЕ БЫЛО ОПОРЫ — самая честная строка панели: показывает, что тут додумывали,
              а не опирались. Без неё «опирались на похожие списки» звучит одинаково и когда
              опирались, и когда линза не нашла ничего и сработал фолбэк. */}
          {(p.noBasis ?? []).length > 0 && (
            <div>
              <span className="font-semibold text-warn">{t('ui.noBasisHere', lang)}:</span>{' '}
              <span className="text-muted">{(p.noBasis ?? []).join(' · ')}</span>
            </div>
          )}
          {p.critique && (
            <div>
              <span className="font-semibold text-ink-2">{t('ui.criticSaid', lang)}:</span>
              {/* Критик пишет markdown (**жирный**, списки) — рендерим, а не показываем звёздочки. */}
              <Markdown className="mt-1 space-y-1 text-muted [&_strong]:text-ink-2">{p.critique.slice(0, 800)}</Markdown>
            </div>
          )}
          {p.depth === 'single' && <div className="text-muted">{t('ui.simpleTopicSingleMaster', lang)}</div>}
        </div>
      )}
    </div>
  )
}
