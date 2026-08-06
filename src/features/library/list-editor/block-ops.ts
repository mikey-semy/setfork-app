import { emptyBlock, type EditorItem } from '../editor'
import type { BlockType } from '../blocks'

/**
 * Операции над составом списка — чистые функции без React.
 *
 * Пункты и их стабильные id (uids) двигаются ПАРАМИ: разъедься они хоть раз, и
 * анимация начнёт возить не те карточки, а undo — восстанавливать чужой порядок.
 * Поэтому все перестановки живут здесь, а не в обработчиках компонента, и
 * проверяются юнит-тестами без монтирования редактора.
 */
export type Snapshot = { items: EditorItem[]; uids: string[] }

const swap = <T,>(xs: T[], i: number, j: number): T[] => {
  const next = [...xs]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

const shift = <T,>(xs: T[], from: number, to: number): T[] => {
  const next = [...xs]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

/** Вставка блока на позицию index (0..len); len — в конец. */
export function insertBlock(snap: Snapshot, index: number, type: BlockType, uid: string): Snapshot {
  const at = Math.max(0, Math.min(index, snap.items.length))
  return {
    items: [...snap.items.slice(0, at), emptyBlock(type), ...snap.items.slice(at)],
    uids: [...snap.uids.slice(0, at), uid, ...snap.uids.slice(at)],
  }
}

/** Удаление блока. Последний не удаляем: пустой редактор нечем показать. */
export function removeBlock(snap: Snapshot, i: number): Snapshot {
  if (snap.items.length <= 1) return snap
  return { items: snap.items.filter((_, idx) => idx !== i), uids: snap.uids.filter((_, idx) => idx !== i) }
}

/** Сдвиг на соседнюю позицию; за краями списка ничего не происходит. */
export function moveBlock(snap: Snapshot, i: number, dir: -1 | 1): Snapshot {
  const j = i + dir
  if (j < 0 || j >= snap.items.length) return snap
  return { items: swap(snap.items, i, j), uids: swap(snap.uids, i, j) }
}

/** Перенос блока на произвольную позицию (перетаскивание, «в начало»/«в конец»). */
export function reorderBlocks(snap: Snapshot, from: number, to: number): Snapshot {
  if (from === to || from < 0 || to < 0 || from >= snap.items.length || to >= snap.items.length) return snap
  return { items: shift(snap.items, from, to), uids: shift(snap.uids, from, to) }
}

/** Правка полей блока: состав и порядок те же, меняется только содержимое. */
export function patchBlock(snap: Snapshot, i: number, p: Partial<EditorItem>): Snapshot {
  return { items: snap.items.map((it, idx) => (idx === i ? { ...it, ...p } : it)), uids: snap.uids }
}
