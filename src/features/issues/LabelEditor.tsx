'use client'

import { useState, useTransition } from 'react'
import { AnchoredMenu } from '@/shared/ui/AnchoredMenu'
import { Check, Tag } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { ISSUE_LABELS, customKey, labelText, type CustomLabel } from '@/shared/lib/labels'
import { LabelChips } from '@/shared/ui/LabelChips'
import { setIssueLabels } from './actions'
import { MenuItem } from '@/shared/ui/MenuItem'

// Метки issue: текущие чипы + поповер-редактор (владелец/коллаборатор), как AssigneePicker.
export function LabelEditor({
  owner,
  slug,
  number,
  onSave,
  labels,
  canEdit,
  lang,
  custom = [],
}: {
  owner: string
  slug: string
  /** Номер задачи; для правки не нужен — действие приходит пропом. */
  number?: number
  labels: string[]
  canEdit: boolean
  /** Своё сохранение метоk (правка). Пусто — задачное. */
  onSave?: (labels: string[]) => Promise<void>
  lang: Lang
  custom?: CustomLabel[]
}) {
  const [pending, start] = useTransition()
  const [sel, setSel] = useState<string[]>(labels)
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

  const toggle = (k: string) => {
    const next = sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]
    setSel(next) // оптимистично
    // Своё сохранение (правка) или задачное по умолчанию — один редактор на обе сущности.
    start(() => void (onSave ? onSave(next) : number != null ? setIssueLabels(owner, slug, number, next) : Promise.resolve()))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <LabelChips labels={sel} lang={lang} custom={custom} />
      {canEdit ? (
        <AnchoredMenu
          align="left"
          width={224}
          className="p-1"
          button={(toggleMenu) => (
            <button
              type="button"
              onClick={toggleMenu}
              aria-label={L('изменить метки', 'edit labels')}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-caption text-muted hover:text-ink"
            >
              <Tag size={11} /> {L('метки', 'labels')}
            </button>
          )}
        >
          {() => (
              <>
                {ISSUE_LABELS.map((l) => {
                  const on = sel.includes(l.key)
                  return (
                    <MenuItem key={l.key} disabled={pending} onClick={() => toggle(l.key)}>
                      <span className={`h-3 w-3 shrink-0 rounded-full border ${l.cls}`} />
                      <span className="flex-1 truncate">{labelText(l.key, lang)}</span>
                      {on && <Check size={13} className="shrink-0 text-accent" />}
                    </MenuItem>
                  )
                })}
                {custom.map((c) => {
                  const key = customKey(c.id)
                  const on = sel.includes(key)
                  return (
                    <MenuItem key={key} disabled={pending} onClick={() => toggle(key)}>
                      <span className="h-3 w-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: c.color }} />
                      <span className="flex-1 truncate">{c.name}</span>
                      {on && <Check size={13} className="shrink-0 text-accent" />}
                    </MenuItem>
                  )
                })}
              </>
          )}
        </AnchoredMenu>
      ) : (
        sel.length === 0 && <span className="text-caption text-muted">{L('нет меток', 'no labels')}</span>
      )}
    </div>
  )
}
