import 'server-only'
import type { ProposedItem } from '@/shared/db'

/**
 * ОБРАТНАЯ ПРАВКА: что стало бы со списком, если отменить один принятый вклад.
 *
 * Чистая функция — вся суть отката здесь, и её видно тестами без БД и без git.
 *
 * Работает по идентичности блоков (ADR-0013), а не по позициям: между слиянием и
 * откатом список живёт своей жизнью — пункты двигают, добавляют соседние. Позиции
 * к этому моменту не значат ничего, а `blockId` переживает перестановку.
 *
 * Три случая, и в каждом отмена определена только тогда, когда пункт с тех пор НЕ
 * трогали:
 *
 *  - правка ДОБАВИЛА пункт → убираем. Если его успели изменить — это уже чужая
 *    работа, и молча стереть её нельзя.
 *  - правка УБРАЛА пункт → возвращаем на прежнее место. Если его уже вернули
 *    руками — считаем сделанным и не плодим второй.
 *  - правка ИЗМЕНИЛА пункт → возвращаем прежнее значение. Если поверх легли ещё
 *    правки — отменять нечего: неизвестно, что из этого отменять.
 *
 * Спорные пункты возвращаются списком, а не «разрешаются» догадкой: человек должен
 * увидеть, ЧТО именно нельзя отменить, и решить сам.
 */
export interface RevertPlan {
  /** Содержимое списка после отмены вклада. */
  items: ProposedItem[]
  /** Пункты, которые трогали после слияния — их отмена не определена. */
  conflicts: { blockId: string; title: string; why: 'changed-since' | 'gone' }[]
}

type Block = ProposedItem & { blockId?: string }

// Служебные поля строки версии: они у каждой версии свои и о содержимом не говорят
// ничего. Сравнение по ним объявляло бы изменившимся ВСЁ подряд, и откат отказывал
// бы всегда. `n` тоже здесь: перестановка — не изменение пункта.
const VOLATILE = new Set(['id', 'versionId', 'version_id', 'n', 'blockId', 'block_id', 'createdAt', 'created_at', 'updatedAt', 'updated_at'])

/** Отпечаток содержимого: порядок ключей не важен, служебные поля не участвуют. */
function contentKey(b: Block): string {
  const rec = b as unknown as Record<string, unknown>
  const keys = Object.keys(rec)
    .filter((k) => !VOLATILE.has(k))
    .sort()
  return JSON.stringify(keys.map((k) => [k, rec[k]]))
}

function sameContent(a: Block | undefined, b: Block | undefined): boolean {
  if (!a || !b) return a === b
  return contentKey(a) === contentKey(b)
}

/**
 * Подпись пункта для списка спорных. Заголовок есть не у всякого блока (текст,
 * картинка, опрос), и хранится он двуязычным объектом — берём любую сторону:
 * человеку нужно узнать пункт, а не получить его на «правильном» языке.
 */
const label = (b: Block | undefined): string => {
  const t = (b as unknown as { title?: unknown } | undefined)?.title
  if (typeof t === 'string') return t.trim() || '(без названия)'
  if (t && typeof t === 'object') {
    const vals = Object.values(t as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && !!v.trim())
    if (vals.length) return vals[0].trim()
  }
  return '(без названия)'
}

const index = (items: Block[]): Map<string, Block> => {
  const m = new Map<string, Block>()
  for (const b of items) if (b.blockId) m.set(b.blockId, b)
  return m
}

export function revertPlan(before: ProposedItem[], after: ProposedItem[], current: ProposedItem[]): RevertPlan {
  const prev = index(before as Block[])
  const post = index(after as Block[])
  const now = index(current as Block[])
  const conflicts: RevertPlan['conflicts'] = []

  // Начинаем с ТЕКУЩЕГО состояния: всё, чего правка не касалась, остаётся как есть.
  const out: Block[] = [...(current as Block[])]

  // 1. Что правка добавила — убираем.
  for (const [id, addedBlock] of post) {
    if (prev.has(id)) continue
    const live = now.get(id)
    if (!live) continue // уже убрали без нас — отменять нечего
    if (!sameContent(live, addedBlock)) {
      conflicts.push({ blockId: id, title: label(live), why: 'changed-since' })
      continue
    }
    const i = out.findIndex((b) => b.blockId === id)
    if (i >= 0) out.splice(i, 1)
  }

  // 2. Что правка изменила — возвращаем прежнее значение.
  for (const [id, oldBlock] of prev) {
    const newBlock = post.get(id)
    if (!newBlock || sameContent(oldBlock, newBlock)) continue // правка этот пункт не меняла
    const live = now.get(id)
    if (!live) {
      conflicts.push({ blockId: id, title: label(oldBlock), why: 'gone' })
      continue
    }
    if (!sameContent(live, newBlock)) {
      conflicts.push({ blockId: id, title: label(live), why: 'changed-since' })
      continue
    }
    const i = out.findIndex((b) => b.blockId === id)
    if (i >= 0) out[i] = { ...oldBlock }
  }

  // 3. Что правка убрала — возвращаем на прежнее место.
  //    Место ищем по СОСЕДУ СВЕРХУ из старой версии: это переживает и перестановки,
  //    и вставки между. Соседа нет (был первым) — возвращаем в начало.
  const beforeIds = (before as Block[]).map((b) => b.blockId).filter((x): x is string => !!x)
  for (const [id, removed] of prev) {
    if (post.has(id)) continue
    if (now.has(id)) continue // вернули руками — второй копии не надо
    const pos = beforeIds.indexOf(id)
    let at = 0
    for (let k = pos - 1; k >= 0; k--) {
      const anchor = out.findIndex((b) => b.blockId === beforeIds[k])
      if (anchor >= 0) {
        at = anchor + 1
        break
      }
    }
    out.splice(at, 0, { ...removed })
  }

  return { items: out as ProposedItem[], conflicts }
}
