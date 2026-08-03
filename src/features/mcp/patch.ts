// Точечная правка списка через MCP: операции над блоками по стабильному bid.
// Чистый модуль (без server-only) — применение операций тестируется без БД.
//
// Форма по мотивам блочных API, где правка адресуется идентификатором, а не
// индексом: Notion (blocks + позиция start/end/after_block) и Google Docs
// batchUpdate (массив операций, применяемый атомарно). Индексы не годятся:
// любая параллельная вставка сдвигает их и патч попадает не в тот блок.
//
// Порядок блоков — здесь; ЧТО такое блок и как накладывается правка — снаружи
// (io): патч ведёт нетронутые блоки в их исходной, доменной форме. Прогон всего
// списка через плоскую MCP-форму стирал бы переводы у непатченных блоков и
// содержимое типов, которых в этой форме нет.

// Тип блока — из tools (импорт ТОЛЬКО типа: server-only рантайм сюда не тянется).
import type { McpItemInput } from './tools'

export type McpPatchOp = Partial<McpItemInput> & {
  op: 'update' | 'insert' | 'delete' | 'move'
  /** Кого правим/двигаем/удаляем (update, delete, move). */
  bid?: string
  /** Куда класть: 'start' | 'end' | bid блока, ПОСЛЕ которого встать (insert, move). */
  after?: string
  /** Что вставляем (insert). */
  block?: McpItemInput
}

/** Как обращаться с блоками конкретного представления. */
export interface PatchIO<T> {
  /** Идентичность блока (по ней адресуются операции). */
  bidOf: (item: T) => string | undefined
  /** Наложить поля операции на существующий блок. */
  update: (item: T, op: McpPatchOp) => T | { error: string }
  /** Собрать новый блок из тела операции insert. */
  create: (block: McpItemInput) => T | { error: string }
}

/** Позиция вставки: 'end'/пусто — в конец, 'start' — в начало, иначе после блока bid. */
function positionAfter<T>(items: T[], bidOf: (item: T) => string | undefined, after: string | undefined): number | { error: string } {
  const a = (after ?? 'end').trim()
  if (a === 'end' || !a) return items.length
  if (a === 'start') return 0
  const i = items.findIndex((b) => bidOf(b) === a)
  return i < 0 ? { error: `unknown bid in "after": "${a}"` } : i + 1
}

/**
 * Применяет операции к текущему составу блоков и возвращает НОВЫЙ состав.
 *
 * Ошибка любой операции отменяет весь патч (как batchUpdate в Google Docs):
 * функция чистая и ничего не пишет, а вызывающий при ошибке просто не сохраняет
 * результат. Половина применённого патча хуже, чем неприменённый: агент не узнает,
 * где именно оборвалось, и повторный вызов наложится на полуправленый список.
 */
export function applyPatchOps<T>(current: T[], ops: McpPatchOp[], io: PatchIO<T>): { items: T[] } | { error: string } {
  if (!ops?.length) return { error: 'ops must not be empty' }
  const items = [...current]
  const indexOf = (bid: string) => items.findIndex((b) => io.bidOf(b) === bid)

  for (const [i, op] of ops.entries()) {
    const at = `op #${i + 1} (${op?.op ?? 'no op'})`
    const bid = (op?.bid ?? '').trim()

    if (op?.op === 'update') {
      const idx = indexOf(bid)
      if (idx < 0) return { error: `${at}: unknown bid "${bid}"` }
      const next = io.update(items[idx], op)
      if (next && typeof next === 'object' && 'error' in next) return { error: `${at}: ${next.error}` }
      items[idx] = next as T
      continue
    }

    if (op?.op === 'delete') {
      const idx = indexOf(bid)
      if (idx < 0) return { error: `${at}: unknown bid "${bid}"` }
      items.splice(idx, 1)
      continue
    }

    if (op?.op === 'insert') {
      if (!op.block) return { error: `${at}: "block" is required` }
      // Тот же bid у двух блоков ломает саму адресацию: операции нашли бы первый
      // из них, а комментарии и blame не различили бы их вовсе.
      const newBid = (op.block.bid ?? '').trim()
      if (newBid && indexOf(newBid) >= 0)
        return { error: `${at}: bid "${newBid}" already exists — omit it to insert a new block, or use op "move"` }
      const pos = positionAfter(items, io.bidOf, op.after)
      if (typeof pos !== 'number') return { error: `${at}: ${pos.error}` }
      const built = io.create(op.block)
      if (built && typeof built === 'object' && 'error' in built) return { error: `${at}: ${built.error}` }
      items.splice(pos, 0, built as T)
      continue
    }

    if (op?.op === 'move') {
      const idx = indexOf(bid)
      if (idx < 0) return { error: `${at}: unknown bid "${bid}"` }
      if ((op.after ?? '').trim() === bid) return { error: `${at}: cannot move a block after itself` }
      const [moved] = items.splice(idx, 1)
      // Позицию считаем ПОСЛЕ изъятия: иначе «переставить вниз» промахивается на
      // единицу — блок ещё занимает своё старое место в подсчёте.
      const pos = positionAfter(items, io.bidOf, op.after)
      if (typeof pos !== 'number') return { error: `${at}: ${pos.error}` }
      items.splice(pos, 0, moved)
      continue
    }

    return { error: `${at}: unknown op — use update, insert, delete or move` }
  }

  if (!items.length) return { error: 'the patch would leave the list empty — a list needs at least one block' }
  return { items }
}

/** Поля операции, которые несут содержимое блока (служебные сняты). */
export function patchFields(op: McpPatchOp): Partial<McpItemInput> {
  const { op: _op, bid: _bid, after: _after, block: _block, ...fields } = op
  void _op, void _bid, void _after, void _block
  // Ключи со значением undefined приходят от клиентов, сериализующих пропуск, —
  // они не должны стирать содержимое (иначе «поправить заголовок» обнулит команду).
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
}
