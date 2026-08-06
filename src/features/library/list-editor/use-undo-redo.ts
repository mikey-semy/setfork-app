'use client'

import { useRef, useState } from 'react'

/**
 * История снимков с отменой и повтором — одна ответственность, без знания о том,
 * что за состояние внутри.
 *
 * Различает два вида правок. Структурная (`commit`) кладёт новый шаг: её отменяют
 * целиком. Правка содержимого (`amend`) заменяет верхний снимок — иначе Ctrl+Z
 * отматывал бы набранный текст по букве. Ветка вперёд обрубается на первом же
 * новом шаге, как в любом редакторе.
 */
export function useUndoRedo<T>(initial: T) {
  const [current, setCurrent] = useState<T>(initial)
  const history = useRef<T[]>([initial])
  const at = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const syncFlags = () => {
    setCanUndo(at.current > 0)
    setCanRedo(at.current < history.current.length - 1)
  }
  const step = (delta: -1 | 1) => {
    const next = at.current + delta
    if (next < 0 || next > history.current.length - 1) return
    at.current = next
    setCurrent(history.current[next])
    syncFlags()
  }

  return {
    current,
    canUndo,
    canRedo,
    /** Новый шаг истории. */
    commit: (next: T) => {
      history.current = [...history.current.slice(0, at.current + 1), next]
      at.current = history.current.length - 1
      setCurrent(next)
      syncFlags()
    },
    /** Правка верхнего снимка, без нового шага. */
    amend: (next: T) => {
      history.current[at.current] = next
      setCurrent(next)
    },
    undo: () => step(-1),
    redo: () => step(1),
  }
}
