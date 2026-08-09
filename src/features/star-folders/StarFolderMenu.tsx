'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { splitSegment } from '@/shared/ui/split-segment'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
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
  const [q, setQ] = useState('')
  const [items, setItems] = useState(folders)
  const [inSet, setInSet] = useState(() => new Set(inFolders))

  const term = q.trim().toLowerCase()
  const shown = term ? items.filter((f) => f.name.toLowerCase().includes(term)) : items

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
      <Tooltip label={ru ? 'В папку' : 'Add to folder'}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={ru ? 'В папку' : 'Add to folder'}
          className={splitSegment({ className: 'px-2 text-muted' })}
        >
          <ChevronDown size={13} />
        </button>
      </Tooltip>
      {/* bare: поля внутри задаёт сама выбиралка, иначе её шапка и футер отошли бы
          от краёв окна — линии обязаны идти от края до края. */}
      <OverlayPanel open={open} onClose={() => setOpen(false)} width={280} bare className="overflow-hidden">
        {/* Та же оболочка, что у выбора списка и ветки: заголовок, поиск, строки. */}
        <PickerPanel
          title={t('switchFolder', lang as Lang)}
          onClose={() => setOpen(false)}
          closeLabel={t('close', lang as Lang)}
          // Папок может стать много — тогда без поиска не найти; на паре штук он лишний.
          search={
            items.length > 5
              ? { value: q, onChange: setQ, placeholder: t('findFolder', lang as Lang), clearLabel: t('clear', lang as Lang) }
              : undefined
          }
          footer={
            // Поле и кнопка одной высоты — ряд не «ступенькой» (правило владельца).
            <div className="flex items-center gap-1.5">
              <Input
                size="sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder={t('newFolderName', lang as Lang)}
                className="h-8 min-w-0 flex-1"
              />
              <Button size="sm" disabled={pending || !newName.trim()} onClick={create} className="h-8 shrink-0">
                <Plus size={13} /> {t('create', lang as Lang)}
              </Button>
            </div>
          }
        >
          {shown.map((f) => (
            <PickerRow
              key={f.id}
              mark="box"
              selected={inSet.has(f.id)}
              label={f.name}
              disabled={pending}
              onClick={() => toggle(f.id)}
            />
          ))}
          {shown.length === 0 && (
            <div className="px-2 py-3 text-[0.78125rem] text-muted">
              {items.length === 0 ? t('noFolders', lang as Lang) : t('nothingFound', lang as Lang)}
            </div>
          )}
        </PickerPanel>
      </OverlayPanel>
    </div>
  )
}
