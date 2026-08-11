'use client'
import { useRef } from 'react'

/** Сколько шагов помним. Дальше — самые старые вытесняются. */
const DEPTH = 300
/** Окно склейки печати: подряд набранное за это время — один шаг отмены. */
const COALESCE_MS = 500

/**
 * История правок поля: undo/redo с той же склейкой, что у обычных редакторов —
 * посимвольная печать откатывается блоком, а не по буквам, тогда как вставка из
 * тулбара или загрузка файла всегда отдельный шаг.
 */
export function useEditorHistory(initial: string, restore: (value: string) => void) {
  const hist = useRef({ stack: [initial], idx: 0, at: 0, typing: false })

  /** Записать состояние. coalesce=true — печать (сливается), false — программная правка. */
  function record(next: string, coalesce: boolean) {
    const h = hist.current
    // Ветка после отмены: то, что «впереди», перестаёт существовать.
    if (h.idx < h.stack.length - 1) h.stack = h.stack.slice(0, h.idx + 1)
    const now = performance.now()
    if (coalesce && h.typing && now - h.at < COALESCE_MS) {
      h.stack[h.idx] = next
    } else {
      h.stack.push(next)
      if (h.stack.length > DEPTH) h.stack.shift()
      h.idx = h.stack.length - 1
    }
    h.at = now
    h.typing = coalesce
  }

  const step = (delta: number) => {
    const h = hist.current
    const next = h.idx + delta
    if (next < 0 || next > h.stack.length - 1) return
    h.idx = next
    h.typing = false
    restore(h.stack[next])
  }

  return { record, undo: () => step(-1), redo: () => step(1) }
}
