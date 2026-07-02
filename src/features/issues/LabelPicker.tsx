'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { ISSUE_LABELS } from './labels'

/** Выбор меток чипами (без нативного select). Пишет скрытые inputs name="labels". */
export function LabelPicker({ lang, initial = [] }: { lang: Lang; initial?: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial))
  const toggle = (k: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...sel].map((k) => (
        <input key={k} type="hidden" name="labels" value={k} />
      ))}
      {ISSUE_LABELS.map((l) => {
        const on = sel.has(l.key)
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => toggle(l.key)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
              on ? l.cls : 'border-border bg-surface text-ink-2 hover:text-ink'
            }`}
          >
            {on && <Check size={11} />}
            {lang === 'ru' ? l.ru : l.en}
          </button>
        )
      })}
    </div>
  )
}
