'use client'

import { useRef } from 'react'
import { emptyItem, type EditorItem } from '../editor'
import type { BlockType } from '../blocks'
import { insertBlock, moveBlock, patchBlock, removeBlock, reorderBlocks, retypeBlock, type Snapshot } from './block-ops'
import { useUndoRedo } from './use-undo-redo'

export type BlockList = ReturnType<typeof useBlockList>

/**
 * Состав списка для редактора: связывает чистые операции (block-ops) с историей
 * (use-undo-redo) и раздаёт стабильные id новым строкам.
 *
 * Правка полей идёт в верхний снимок, структурная — новым шагом: этим и отличается
 * «набрал букву» от «переставил блок» при Ctrl+Z.
 */
export function useBlockList(initial: EditorItem[]) {
  const first = initial.length ? initial : [emptyItem()]
  // Начальные id детерминированы: случайные разошлись бы между сервером и клиентом
  // при гидрации.
  const start: Snapshot = { items: first, uids: first.map((_, i) => 'r' + i) }
  const nextUid = useRef(first.length)
  const newUid = () => 'r' + nextUid.current++

  const history = useUndoRedo<Snapshot>(start)
  const snap = history.current

  return {
    items: snap.items,
    uids: snap.uids,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
    patch: (i: number, p: Partial<EditorItem>) => history.amend((cur) => patchBlock(cur, i, p)),
    /**
     * Правка блока по его стабильному id — для того, что возвращается ПОЗЖЕ:
     * загруженный файл прилетает через секунды, и за это время блок мог уехать на
     * другое место. По индексу результат лёг бы в чужой блок.
     */
    patchByUid: (uid: string, p: Partial<EditorItem>) =>
      history.amend((cur) => {
        const i = cur.uids.indexOf(uid)
        return i < 0 ? cur : patchBlock(cur, i, p)
      }),
    insertAt: (index: number, type: BlockType) => history.commit((cur) => insertBlock(cur, index, type, newUid())),
    removeAt: (i: number) => history.commit((cur) => removeBlock(cur, i)),
    move: (i: number, dir: -1 | 1) => history.commit((cur) => moveBlock(cur, i, dir)),
    moveToEdge: (i: number, edge: 'top' | 'bottom') => history.commit((cur) => reorderBlocks(cur, i, edge === 'top' ? 0 : cur.items.length - 1)),
    reorder: (from: number, to: number) => history.commit((cur) => reorderBlocks(cur, from, to)),
    /** Смена типа блока на месте (слэш-меню): структурная правка, отменяется целиком. */
    retype: (i: number, type: BlockType) => history.commit((cur) => retypeBlock(cur, i, type)),
    /** Полная замена состава (правка ИИ): строки новые, id тоже новые. */
    replaceAll: (next: EditorItem[]) => history.commit(() => ({ items: next, uids: next.map(() => newUid()) })),
  }
}
