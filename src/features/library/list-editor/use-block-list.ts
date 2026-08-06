'use client'

import { useRef, useState } from 'react'
import { emptyBlock, emptyItem, type EditorItem } from '../editor'
import type { BlockType } from '../blocks'

/**
 * Состав списка и его история — одна зона ответственности.
 *
 * Пункты живут рядом со стабильными id (uids): по ним React отличает строки, а
 * FLIP-анимация понимает, кто куда переехал. Любая структурная правка идёт через
 * `commit` — новый шаг истории; правка текста заменяет верхний снимок, иначе undo
 * отматывал бы по букве.
 */
export type BlockList = ReturnType<typeof useBlockList>

type Snapshot = { items: EditorItem[]; uids: string[] }

export function useBlockList(initial: EditorItem[]) {
  const first = initial.length ? initial : [emptyItem()]
  // Начальные id детерминированы — иначе сервер и клиент разошлись бы при гидрации.
  const firstUids = first.map((_, i) => 'r' + i)

  const [items, setItems] = useState<EditorItem[]>(first)
  const [uids, setUids] = useState<string[]>(firstUids)
  const nextUid = useRef(first.length)
  const newUid = () => 'r' + nextUid.current++

  const history = useRef<Snapshot[]>([{ items: first, uids: firstUids }])
  const at = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncFlags = () => {
    setCanUndo(at.current > 0)
    setCanRedo(at.current < history.current.length - 1)
  }

  const apply = (s: Snapshot) => {
    setItems(s.items)
    setUids(s.uids)
  }
  /** Структурная правка: добавить/удалить/переместить — новый шаг истории. */
  const commit = (nextItems: EditorItem[], nextUids: string[]) => {
    history.current = [...history.current.slice(0, at.current + 1), { items: nextItems, uids: nextUids }]
    at.current = history.current.length - 1
    apply({ items: nextItems, uids: nextUids })
    syncFlags()
  }
  /** Правка текста: состав и порядок те же — обновляем верхний снимок. */
  const commitText = (nextItems: EditorItem[]) => {
    history.current[at.current] = { items: nextItems, uids }
    setItems(nextItems)
  }

  const swapped = <T,>(xs: T[], i: number, j: number): T[] => {
    const next = [...xs]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  }
  const moved = <T,>(xs: T[], from: number, to: number): T[] => {
    const next = [...xs]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    return next
  }

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    commit(moved(items, from, to), moved(uids, from, to))
  }

  return {
    items,
    uids,
    canUndo,
    canRedo,
    patch: (i: number, p: Partial<EditorItem>) => commitText(items.map((it, idx) => (idx === i ? { ...it, ...p } : it))),
    /** Вставка на позицию index (0..len); len — в конец. */
    insertAt: (index: number, type: BlockType) => {
      const pos = Math.max(0, Math.min(index, items.length))
      commit([...items.slice(0, pos), emptyBlock(type), ...items.slice(pos)], [...uids.slice(0, pos), newUid(), ...uids.slice(pos)])
    },
    /** Последний блок не удаляем: пустой редактор нечем показать. */
    removeAt: (i: number) => {
      if (items.length > 1) commit(items.filter((_, idx) => idx !== i), uids.filter((_, idx) => idx !== i))
    },
    move: (i: number, dir: -1 | 1) => {
      const j = i + dir
      if (j < 0 || j >= items.length) return
      commit(swapped(items, i, j), swapped(uids, i, j))
    },
    moveToEdge: (i: number, edge: 'top' | 'bottom') => reorder(i, edge === 'top' ? 0 : items.length - 1),
    reorder,
    /** Полная замена состава (правка ИИ): все строки новые, id тоже. */
    replaceAll: (next: EditorItem[]) => commit(next, next.map(() => newUid())),
    undo: () => {
      if (at.current === 0) return
      at.current -= 1
      apply(history.current[at.current])
      syncFlags()
    },
    redo: () => {
      if (at.current >= history.current.length - 1) return
      at.current += 1
      apply(history.current[at.current])
      syncFlags()
    },
  }
}
