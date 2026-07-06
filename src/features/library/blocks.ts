// Типы блоков списка (всё-блочная модель). Чистый модуль без server-only —
// используется и на сервере, и в редакторе. См. дизайн-док по блочному редактору.

export const BLOCK_TYPES = ['step', 'text', 'image'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export const isBlockType = (t: string): t is BlockType => (BLOCK_TYPES as readonly string[]).includes(t)

/** Стабильный id блока — живёт ВНУТРИ content (content.bid) у не-step блоков.
 *  Даёт идентичность для three-way merge: правка text/image — modify, а не add+remove.
 *  Хранение внутри content = ноль правок схемы/proto/Rust (content round-trip'ится
 *  опрозрачно). Генерится один раз при создании блока в редакторе. */
export function newBlockId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'b' + Math.random().toString(36).slice(2, 12)
}

// Две РАЗНЫЕ оси «исполнения» (уточнение от юзера):
//  1) Ручной прогон/использование — проходим список руками. Чек-действия — шаги;
//     text/image — контекст (показываются, отметки не требуют).
//  2) Скрипт (curl|bash) — исполняется ТОЛЬКО код. Шаг с командой → строка
//     скрипта; всё без кода → комментарий/echo (просто показать в консоли).

/** Чекается ли блок в ручном прогоне (действие, которое отмечают). */
export const isCheckable = (t: string): boolean => t === 'step'

/** Идёт ли блок исполняемой строкой в скрипт — зависит от НАЛИЧИЯ КОДА,
 *  а не только от типа. Остальное в скрипте — echo/комментарий. */
export const goesToScript = (t: string, command?: string): boolean => t === 'step' && !!command?.trim()

// Payload не-step блоков (в колонке steps.content). Step-блок payload не использует
// (его поля — в собственных колонках title/desc/command/…).
export interface TextBlockContent {
  md: string // markdown-врезка
}
export interface ImageBlockContent {
  ref?: string // storage_key картинки (как imageKey у шага)
  caption?: string
}

export const BLOCK_META: Record<BlockType, { icon: string; en: string; ru: string }> = {
  step: { icon: '👣', en: 'Step', ru: 'Шаг' },
  text: { icon: '📝', en: 'Text', ru: 'Текст' },
  image: { icon: '🖼️', en: 'Image', ru: 'Картинка' },
}
