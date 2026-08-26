'use client'

import { useState, type KeyboardEvent } from 'react'
import { TOUCH_MIN_H } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import type { BlockType } from '../blocks'
import { BLOCK_ICON, blockLabel, matchBlockTypes, slashQuery } from './block-meta'
import { cardClass } from '@/shared/ui/card-style'

/**
 * Слэш-меню: «/» в пустом текстовом блоке открывает список типов, выбор превращает
 * блок в выбранный.
 *
 * Это самый дешёвый способ вставки для клавиатуры — руки не уходят с текста, — и он
 * дополняет радиальный инсертер, который хорош пальцем. Справочник типов общий с
 * инсертером и шапкой карточки: третьей копии списка блоков быть не должно.
 */
export function useSlashMenu({ value, lang, onPick }: { value: string; lang: Lang; onPick: (type: BlockType) => void }) {
  const query = slashQuery(value)
  const options = query === null ? [] : matchBlockTypes(query, lang)
  // Помним ВЫБРАННЫЙ ТИП, а не его номер: список сужается на каждую букву запроса, и
  // номер в нём указывал бы то на исчезнувший пункт, то на соседний. Слетел из
  // выборки — подсветка сама возвращается на первый, безо всякого эффекта-сброса.
  const [picked, setPicked] = useState<BlockType | null>(null)
  const active = picked && options.includes(picked) ? picked : (options[0] ?? null)

  const open = query !== null && options.length > 0

  return {
    open,
    options,
    active,
    pick: onPick,
    highlight: setPicked,
    /** Клавиатура меню; вешается на обёртку блока и возвращает true, если событие съедено. */
    onKeyDown: (e: KeyboardEvent) => {
      if (!open || !active) return false
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : options.length - 1
        setPicked(options[(options.indexOf(active) + step) % options.length])
        return true
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        onPick(active)
        return true
      }
      return false
    },
  }
}

export function SlashMenu({ menu, lang }: { menu: ReturnType<typeof useSlashMenu>; lang: Lang }) {
  if (!menu.open) return null
  return (
    <div role="listbox" aria-label={t('editor.blockType', lang)} className={cardClass({ pad: 'xs', className: 'absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto shadow-lg' })}>
      {menu.options.map((type) => {
        const Icon = BLOCK_ICON[type]
        return (
          <button
            key={type}
            type="button"
            role="option"
            aria-selected={type === menu.active}
            // Мышью выбор идёт по наведению, как в любом таком меню; на тач-экране
            // наведения нет, и первый же тап сразу выбирает.
            onMouseEnter={() => menu.highlight(type)}
            onClick={() => menu.pick(type)}
            className={`flex w-full items-center gap-2 rounded px-2 text-left text-body ${TOUCH_MIN_H} ${type === menu.active ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}
          >
            <Icon size={14} className="shrink-0" />
            {blockLabel(type, lang)}
          </button>
        )
      })}
    </div>
  )
}
