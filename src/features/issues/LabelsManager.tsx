'use client'

import { useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { ColorSwatch } from '@/shared/ui/ColorSwatch'
import { chipColors, type CustomLabel } from '@/shared/lib/labels'
import { createLabel, deleteLabel } from './label-actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'

const PRESET = ['#2159d6', '#7c3aed', '#15803d', '#c2570c', '#be123c', '#0f766e', '#b45309', '#475569']

/** Управление кастомными метками списка (владелец/коллаборатор). */
export function LabelsManager({ templateId, initial, lang }: { templateId: string; initial: CustomLabel[]; lang: Lang }) {
  const ru = lang === 'ru'
  const [labels, setLabels] = useState<CustomLabel[]>(initial)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET[0])
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function add() {
    if (!name.trim()) return
    setErr('')
    start(async () => {
      const res = await createLabel(templateId, name, color)
      if ('error' in res) {
        setErr(
          res.error === 'exists'
            ? ru ? 'Метка с таким именем уже есть.' : 'A label with this name already exists.'
            : res.error === 'forbidden'
              ? ru ? 'Нет прав.' : 'Not allowed.'
              : ru ? 'Проверь имя и цвет.' : 'Check name and color.',
        )
        return
      }
      setLabels((prev) => [...prev, res.label].sort((a, b) => a.name.localeCompare(b.name)))
      setName('')
    })
  }

  function remove(id: string) {
    setLabels((prev) => prev.filter((l) => l.id !== id))
    start(async () => {
      await deleteLabel(id)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {labels.length === 0 && <span className="text-[0.78125rem] text-muted">{ru ? 'Кастомных меток пока нет.' : 'No custom labels yet.'}</span>}
        {labels.map((l) => (
          <span key={l.id} style={chipColors(l.color)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.78125rem] font-medium">
            {l.name}
            <button type="button" onClick={() => remove(l.id)} disabled={pending} aria-label={ru ? 'удалить' : 'delete'} className="opacity-70 hover:opacity-100">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1">
          {PRESET.map((c) => (
            <ColorSwatch key={c} color={c} selected={color === c} label={c} onSelect={() => setColor(c)} />
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          placeholder={ru ? 'имя метки' : 'label name'}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          className={buttonClass({ className: 'min-w-0 flex-1 bg-surface-2 outline-hidden' })}
        />
        <Button variant="primary" onClick={add} disabled={pending || !name.trim()}>
          {pending ? <Spinner size="sm" /> : <Plus size={13} />} {ru ? 'Добавить' : 'Add'}
        </Button>
      </div>
      {err && <span className="text-[0.78125rem] text-danger">{err}</span>}
    </div>
  )
}
