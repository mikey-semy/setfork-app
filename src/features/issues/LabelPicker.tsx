'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { ISSUE_LABELS, chipColors, customKey, type CustomLabel } from '@/shared/lib/labels'

/** Выбор меток чипами (без нативного select). Пишет скрытые inputs name="labels".
 *  custom — кастомные метки списка (сверх встроенной палитры). */
export function LabelPicker({ lang, initial = [], custom = [] }: { lang: Lang; initial?: string[]; custom?: CustomLabel[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial))
  const toggle = (k: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const off = 'border-border bg-surface text-ink-2 hover:text-ink'
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
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.78125rem] transition-colors ${on ? l.cls : off}`}
          >
            {on && <Check size={11} />}
            {lang === 'ru' ? l.ru : l.en}
          </button>
        )
      })}
      {custom.map((c) => {
        const key = customKey(c.id)
        const on = sel.has(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            style={on ? chipColors(c.color) : undefined}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.78125rem] transition-colors ${on ? '' : off}`}
          >
            {on ? <Check size={11} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />}
            {c.name}
          </button>
        )
      })}
    </div>
  )
}
