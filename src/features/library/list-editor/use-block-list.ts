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
    patch: (i: number, p: Partial<EditorItem>) => history.amend(patchBlock(snap, i, p)),
    insertAt: (index: number, type: BlockType) => history.commit(insertBlock(snap, index, type, newUid())),
    removeAt: (i: number) => history.commit(removeBlock(snap, i)),
    move: (i: number, dir: -1 | 1) => history.commit(moveBlock(snap, i, dir)),
    moveToEdge: (i: number, edge: 'top' | 'bottom') => history.commit(reorderBlocks(snap, i, edge === 'top' ? 0 : snap.items.length - 1)),
    reorder: (from: number, to: number) => history.commit(reorderBlocks(snap, from, to)),
    /** Смена типа блока на месте (слэш-меню): структурная правка, отменяется целиком. */
    retype: (i: number, type: BlockType) => history.commit(retypeBlock(snap, i, type)),
    /** Полная замена состава (правка ИИ): строки новые, id тоже новые. */
    replaceAll: (next: EditorItem[]) => history.commit({ items: next, uids: next.map(() => newUid()) }),
  }
}
