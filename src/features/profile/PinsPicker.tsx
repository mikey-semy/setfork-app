'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { Button } from '@/shared/ui/button'
import { updatePins } from '@/features/library/actions'
import { t, type Lang } from '@/shared/i18n'

const MAX_PINS = 6

/** «Customize your pins» (как GitHub): выбрать до 6 своих списков для Overview. */
export function PinsPicker({
  lists,
  lang,
}: {
  lists: { id: string; slug: string; pinned: boolean }[]
  lang: Lang
}) {
  const ru = lang === 'ru'
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [sel, setSel] = useState<Set<string>>(() => new Set(lists.filter((l) => l.pinned).map((l) => l.id)))

  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else if (n.size < MAX_PINS) n.add(id)
      return n
    })

  const save = () =>
    start(async () => {
      await updatePins([...sel])
      setOpen(false)
    })

  if (lists.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-accent"
      >
        <Pencil size={11} /> {ru ? 'Настроить' : 'Customize your pins'}
      </button>
      {/* Шапка одна — у PickerPanel (title со счётчиком); OverlayPanel остаётся
          без title, иначе получилось бы два заголовка. */}
      <OverlayPanel open={open} onClose={() => setOpen(false)} className="overflow-hidden">
        <PickerPanel
          title={
            <span>
              {ru ? 'Закреплённые списки' : 'Pinned lists'}{' '}
              <span className="font-mono text-[11px] text-muted">
                {sel.size}/{MAX_PINS}
              </span>
            </span>
          }
          onClose={() => setOpen(false)}
          closeLabel={t('close', lang)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {ru ? 'Отмена' : 'Cancel'}
              </Button>
              <Button variant="primary" onClick={save} disabled={pending}>
                {ru ? 'Сохранить' : 'Save pins'}
              </Button>
            </div>
          }
        >
          {lists.map((l) => {
            const on = sel.has(l.id)
            const full = !on && sel.size >= MAX_PINS
            return (
              <PickerRow
                key={l.id}
                mark="box"
                selected={on}
                disabled={pending || full}
                onClick={() => toggle(l.id)}
                label={l.slug}
              />
            )
          })}
        </PickerPanel>
      </OverlayPanel>
    </>
  )
}
