'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { Chip } from '@/shared/ui/Chip'
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
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...sel].map((k) => (
        <input key={k} type="hidden" name="labels" value={k} />
      ))}
      {ISSUE_LABELS.map((l) => {
        const on = sel.has(l.key)
        return (
          <Chip key={l.key} onClick={() => toggle(l.key)} selected={on} className={on ? l.cls : undefined}>
            {on && <Check size={11} />}
            {lang === 'ru' ? l.ru : l.en}
          </Chip>
        )
      })}
      {custom.map((c) => {
        const key = customKey(c.id)
        const on = sel.has(key)
        return (
          <Chip key={key} onClick={() => toggle(key)} selected={on} style={on ? chipColors(c.color) : undefined}>
            {on ? <Check size={11} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />}
            {c.name}
          </Chip>
        )
      })}
    </div>
  )
}
