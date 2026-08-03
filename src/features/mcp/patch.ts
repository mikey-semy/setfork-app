// Точечная правка списка через MCP: операции над блоками по стабильному bid.
// Чистый модуль (без server-only) — применение операций тестируется без БД.
//
// Форма по мотивам блочных API, где правка адресуется идентификатором, а не
// индексом: Notion (blocks + позиция start/end/after_block) и Google Docs
// batchUpdate (массив операций, применяемый атомарно). Индексы не годятся:
// любая параллельная вставка сдвигает их и патч попадает не в тот блок.

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

/** Позиция вставки: 'end'/пусто — в конец, 'start' — в начало, иначе после блока bid. */
function positionAfter(items: McpItemInput[], after: string | undefined): number | { error: string } {
  const a = (after ?? 'end').trim()
  if (a === 'end' || !a) return items.length
  if (a === 'start') return 0
  const i = items.findIndex((b) => b.bid === a)
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
export function applyPatchOps(current: McpItemInput[], ops: McpPatchOp[]): { items: McpItemInput[] } | { error: string } {
  if (!ops?.length) return { error: 'ops must not be empty' }
  const items = current.map((b) => ({ ...b }))

  for (const [i, op] of ops.entries()) {
    const at = `op #${i + 1} (${op?.op ?? 'no op'})`
    const bid = (op?.bid ?? '').trim()

    if (op?.op === 'update') {
      const idx = items.findIndex((b) => b.bid === bid)
      if (idx < 0) return { error: `${at}: unknown bid "${bid}"` }
      // Патч частичный: поле, которого нет в операции, остаётся прежним. Ключи со
      // значением undefined приходят от клиентов, сериализующих пропуск, — они не
      // должны стирать содержимое (иначе «поправить заголовок» обнулит команду).
      const { op: _op, bid: _bid, after: _after, block: _block, ...fields } = op
      void _op, void _bid, void _after, void _block
      const merged: Record<string, unknown> = { ...items[idx] }
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) merged[k] = v
      items[idx] = merged as McpItemInput
      continue
    }

    if (op?.op === 'delete') {
      const idx = items.findIndex((b) => b.bid === bid)
      if (idx < 0) return { error: `${at}: unknown bid "${bid}"` }
      items.splice(idx, 1)
      continue
    }

    if (op?.op === 'insert') {
      if (!op.block) return { error: `${at}: "block" is required` }
      const pos = positionAfter(items, op.after)
      if (typeof pos !== 'number') return { error: `${at}: ${pos.error}` }
      items.splice(pos, 0, { ...op.block })
      continue
    }

    if (op?.op === 'move') {
      const idx = items.findIndex((b) => b.bid === bid)
      if (idx < 0) return { error: `${at}: unknown bid "${bid}"` }
      if ((op.after ?? '').trim() === bid) return { error: `${at}: cannot move a block after itself` }
      const [moved] = items.splice(idx, 1)
      // Позицию считаем ПОСЛЕ изъятия: иначе «переставить вниз» промахивается на
      // единицу — блок ещё занимает своё старое место в подсчёте.
      const pos = positionAfter(items, op.after)
      if (typeof pos !== 'number') return { error: `${at}: ${pos.error}` }
      items.splice(pos, 0, moved)
      continue
    }

    return { error: `${at}: unknown op — use update, insert, delete or move` }
  }

  if (!items.length) return { error: 'the patch would leave the list empty — a list needs at least one block' }
  return { items }
}
