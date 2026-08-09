'use client'

import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Badge } from './badge'
import { TOUCH_MIN_H } from './control'
import { Tooltip } from './Tooltip'

/**
 * Список сущностей, которые ПРАВЯТСЯ В ОКНЕ, а в форме показаны чипами.
 *
 * Так устроены ссылка и товар: у обеих несколько полей (подпись, адрес, у товара
 * ещё уровень и заметка), и целый ряд полей на каждую строку не помещался даже на
 * десктопе, не говоря о телефоне. Смотреть на «https://…» всё время незачем —
 * адрес нужен один раз при вводе.
 *
 * Компонент отвечает ровно за оболочку: чипы, удаление, «добавить» и состояние
 * «какую строку сейчас правим». Что показывать в чипе и какие поля в окне —
 * решает вызывающий, поэтому вторая такая сущность не породит второй копии.
 */
export function ChipList<T>({
  items,
  onChange,
  chip,
  chipTitle,
  removeLabel,
  addButton,
  dialog,
}: {
  items: T[]
  onChange: (next: T[]) => void
  /** Содержимое чипа — то, что человек читает: подпись и домен, название и цена. */
  chip: (item: T) => ReactNode
  /** Подсказка на чипе (полный адрес, полное название). */
  chipTitle?: (item: T) => string
  removeLabel: string
  /** Кнопка «добавить»: своя подпись у каждого списка («ссылку», «товар»). */
  addButton: (open: () => void) => ReactNode
  /** Окно правки; index < 0 — добавление новой строки. */
  dialog: (args: { open: boolean; index: number; item: T | undefined; save: (v: T) => void; close: () => void }) => ReactNode
}) {
  // null — окно закрыто; -1 — добавляем; иначе номер правимой строки.
  const [editing, setEditing] = useState<number | null>(null)

  const save = (v: T) => {
    if (editing === null) return
    onChange(editing < 0 ? [...items, v] : items.map((x, i) => (i === editing ? v : x)))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, i) => (
        <Badge key={i} variant="soft" className="gap-1 bg-surface-2 pr-1 font-medium text-ink-2">
          <Tooltip label={chipTitle?.(item) ?? ''}>
            <button type="button" onClick={() => setEditing(i)} className={`flex min-w-0 items-center gap-1.5 hover:text-ink ${TOUCH_MIN_H}`}>
              {chip(item)}
            </button>
          </Tooltip>
          {/* Крестик того же вида, что у тегов: один приём на все списки чипов. */}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, xi) => xi !== i))}
            aria-label={removeLabel}
            className="grid size-4 place-items-center rounded-full text-muted hover:bg-surface hover:text-danger"
          >
            <X size={11} />
          </button>
        </Badge>
      ))}
      {addButton(() => setEditing(-1))}
      {dialog({
        open: editing !== null,
        index: editing ?? -1,
        item: editing !== null && editing >= 0 ? items[editing] : undefined,
        save,
        close: () => setEditing(null),
      })}
    </div>
  )
}
