'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { createStarFolder, toggleListInFolder } from './actions'
import type { StarFolder } from './queries'

/** Правая половина split-кнопки звезды (▾): чекбоксы папок + создать новую —
 *  как выпадашка у Star на GitHub (Lists). Рендерится вплотную к StarButton. */
export function StarFolderMenu({
  templateId,
  folders,
  inFolders,
  lang = 'en',
}: {
  templateId: string
  folders: StarFolder[]
  inFolders: string[]
  lang?: string
}) {
  const ru = lang === 'ru'
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [newName, setNewName] = useState('')
  const [items, setItems] = useState(folders)
  const [inSet, setInSet] = useState(() => new Set(inFolders))

  const toggle = (id: string) => {
    setInSet((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
    start(() => void toggleListInFolder(id, templateId))
  }

  const create = () => {
    const name = newName.trim()
    if (!name) return
    start(async () => {
      const r = await createStarFolder(name)
      if ('id' in r) {
        await toggleListInFolder(r.id, templateId)
        setItems((p) => [...p, { id: r.id, name, count: 1 }].sort((a, b) => a.name.localeCompare(b.name)))
        setInSet((p) => new Set(p).add(r.id))
      }
      setNewName('')
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ru ? 'В папку' : 'Add to folder'}
        title={ru ? 'В папку' : 'Add to folder'}
        className="inline-flex h-full items-center rounded-r-md border border-l-0 border-border px-1.5 py-1.5 text-muted hover:bg-surface-2 hover:text-ink"
      >
        <ChevronDown size={14} />
      </button>
      <OverlayPanel open={open} onClose={() => setOpen(false)} width={280} className="p-2" title={ru ? 'В папку' : 'Add to folder'}>
              <div className="max-h-[240px] overflow-y-auto">
                {items.map((f) => {
                  const on = inSet.has(f.id)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={pending}
                      onClick={() => toggle(f.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-ink hover:bg-surface-2 disabled:opacity-60"
                    >
                      <span className={`grid h-4 w-4 place-items-center rounded border ${on ? 'border-accent bg-accent text-primary-fg' : 'border-border'}`}>
                        {on && <Check size={12} />}
                      </span>
                      <span className="truncate">{f.name}</span>
                    </button>
                  )
                })}
                {items.length === 0 && <div className="px-2 py-1.5 text-[12.5px] text-muted">{ru ? 'Папок пока нет.' : 'No folders yet.'}</div>}
              </div>
              <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                  placeholder={ru ? 'Новая папка' : 'New folder'}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[13px] text-ink outline-hidden focus:border-border-strong"
                />
                <button
                  type="button"
                  disabled={pending || !newName.trim()}
                  onClick={create}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[12.5px] font-semibold text-primary-fg disabled:opacity-50"
                >
                  <Plus size={13} /> {ru ? 'Создать' : 'Create'}
                </button>
              </div>
      </OverlayPanel>
    </div>
  )
}
