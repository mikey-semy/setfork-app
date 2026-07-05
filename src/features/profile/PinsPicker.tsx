'use client'

import { useState, useTransition } from 'react'
import { Check, Pencil } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { updatePins } from '@/features/library/actions'
import type { Lang } from '@/shared/i18n'

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
        className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-accent"
      >
        <Pencil size={11} /> {ru ? 'Настроить' : 'Customize your pins'}
      </button>
      <OverlayPanel
        open={open}
        onClose={() => setOpen(false)}
        className="flex max-h-[70vh] flex-col"
        title={
          <span>
            {ru ? 'Закреплённые списки' : 'Pinned lists'}{' '}
            <span className="font-mono text-[11px] text-muted">
              {sel.size}/{MAX_PINS}
            </span>
          </span>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {lists.map((l) => {
                  const on = sel.has(l.id)
                  const full = !on && sel.size >= MAX_PINS
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={pending || full}
                      onClick={() => toggle(l.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-ink hover:bg-surface-2 disabled:opacity-45"
                    >
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-primary-fg' : 'border-border'}`}>
                        {on && <Check size={12} />}
                      </span>
                      <span className="truncate">{l.slug}</span>
                    </button>
                  )
                })}
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-3.5 py-2.5">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink">
                  {ru ? 'Отмена' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-fg disabled:opacity-60"
                >
                  {ru ? 'Сохранить' : 'Save pins'}
                </button>
        </div>
      </OverlayPanel>
    </>
  )
}
