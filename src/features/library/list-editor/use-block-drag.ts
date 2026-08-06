'use client'

import { useState, type DragEvent } from 'react'
import { dropTargetIndex } from './block-ops'

/** Что тащат и куда целятся — ОДНО значение, а не три переменные: сочетания вроде
 *  «цель есть, а тащить нечего» становятся невыразимыми. */
type Dragging = { from: number; over: number; side: 'before' | 'after' } | null

/**
 * Перетаскивание карточек мышью.
 *
 * Место вставки показывается линией у ближней кромки карточки, а не подсветкой её
 * рамки: рамка отвечала на вопрос «над какой карточкой курсор», но не на главный —
 * «выше или ниже она встанет».
 *
 * Работает только с мышью: HTML5 drag-and-drop построен на мышиных событиях, и на
 * тач-экранах его может не быть вовсе. Поэтому стрелки и Alt+↑/↓ остаются полным
 * путём перестановки, а не подспорьем.
 */
export function useBlockDrag(reorder: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<Dragging>(null)

  const stop = () => setDrag(null)

  return {
    /** Индекс карточки, которую тащат: она бледнеет на своём месте. */
    draggingFrom: drag?.from ?? null,
    /** У какой кромки карточки i рисовать линию (null — не рисовать). */
    lineAt: (i: number): 'before' | 'after' | null => (drag && drag.over === i ? drag.side : null),
    handlers: (i: number) => ({
      onDragStart: () => setDrag({ from: i, over: i, side: 'before' }),
      onDragEnd: stop,
      onDragOver: (e: DragEvent) => {
        if (!drag) return
        e.preventDefault()
        // Ближняя половина карточки решает, встанет блок над ней или под.
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const side = e.clientY < box.top + box.height / 2 ? 'before' : 'after'
        if (drag.over !== i || drag.side !== side) setDrag({ ...drag, over: i, side })
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (drag) reorder(drag.from, dropTargetIndex(drag.from, i, drag.side))
        stop()
      },
    }),
  }
}
