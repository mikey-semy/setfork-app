'use client'

import { useState } from 'react'
import { ChevronRight, ScrollText } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { prettyModelName } from '@/shared/ai/model-names'

/**
 * Родословная кандидата (HQ §6, объяснимость): «почему ты это предложил тогда?» —
 * кто ковал и на чём, какие прецеденты и правила легли в промпты, что сказал
 * критик. Данные из provenance (#358) — копятся при каждом витке.
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

export function ProvenancePanel({ provenance, lang }: { provenance: Record<string, unknown>; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  const [open, setOpen] = useState(false)
  const p = provenance as Prov
  const hasAny = Boolean(p.experts?.length || p.precedents?.length || p.craftRules?.length || p.critique || p.depth)
  if (!hasAny) return null

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
        <ScrollText size={11} /> {say('Lineage', 'Родословная')}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3 text-[11.5px] leading-relaxed">
          {p.experts && p.experts.length > 0 && (
            <div>
              <span className="font-semibold text-ink-2">{say('Forged by', 'Ковали')}:</span>{' '}
              <span className="text-muted">{p.experts.map((e) => `${e.id} (${prettyModelName(e.model)})`).join(' · ')}</span>
            </div>
          )}
          {row(say('Precedents', 'Прецеденты'), (p.precedents ?? []).map((x) => x.title))}
          {row(say('Craft rules', 'Правила ремесла'), p.craftRules ?? [])}
          {p.critique && (
            <div>
              <span className="font-semibold text-ink-2">{say('Critic said', 'Критик сказал')}:</span>{' '}
              <span className="whitespace-pre-wrap text-muted">{p.critique.slice(0, 500)}</span>
            </div>
          )}
          {p.depth === 'single' && <div className="text-muted">{say('Simple topic — a single gnome wrote it.', 'Тема простая — писал один гном.')}</div>}
        </div>
      )}
    </div>
  )
}
