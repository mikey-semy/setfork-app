'use client'

import { useState } from 'react'
import { ChevronRight, ScrollText } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { prettyModelName } from '@/shared/ai/model-names'

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
  critique?: string
  models?: Record<string, string>
}

export function ProvenancePanel({ provenance, gnomeNames, lang }: { provenance: Record<string, unknown>; gnomeNames?: Record<string, string>; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  const [open, setOpen] = useState(false)
  const p = provenance as Prov
  const hasAny = Boolean(p.experts?.length || p.precedents?.length || p.craftRules?.length || p.critique || p.depth)
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
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-[11.5px] text-muted hover:text-ink-2"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <ScrollText size={11} /> {say('How the list was built', 'Как собран список')}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3 text-[11.5px] leading-relaxed">
          <p className="text-muted">
            {say('Transparency of the workshop: who took part and what they leaned on.', 'Прозрачность мастерской: кто участвовал и на что опирался.')}
          </p>
          {p.experts && p.experts.length > 0 && (
            <div>
              {/* Имя гнома — крупно, модель (его «инструмент») — мелко и в скобках. */}
              <span className="font-semibold text-ink-2">{say('Gnomes', 'Гномы')}:</span>{' '}
              <span className="text-muted">
                {p.experts.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ' · '}
                    {nameOf(e.id)} <span className="text-[10px] opacity-70">({prettyModelName(e.model)})</span>
                  </span>
                ))}
              </span>
            </div>
          )}
          {row(say('Leaned on similar lists', 'Опирались на похожие списки'), (p.precedents ?? []).map((x) => x.title))}
          {row(say('Craft rules held', 'Держали правила ремесла'), p.craftRules ?? [])}
          {p.critique && (
            <div>
              <span className="font-semibold text-ink-2">{say('Critic said', 'Критик заметил')}:</span>
              {/* Критик пишет markdown (**жирный**, списки) — рендерим, а не показываем звёздочки. */}
              <Markdown className="mt-1 space-y-1 text-muted [&_strong]:text-ink-2">{p.critique.slice(0, 800)}</Markdown>
            </div>
          )}
          {p.depth === 'single' && <div className="text-muted">{say('Simple topic — a single gnome wrote it.', 'Тема простая — писал один гном.')}</div>}
        </div>
      )}
    </div>
  )
}
