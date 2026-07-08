import { Bold, Code, Heading, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough } from 'lucide-react'

// Общие markdown-команды тулбара — единый набор для MarkdownEditor и
// BubbleTextEditor (списки кнопок дрейфовали: разошёлся порядок 2-й группы).

export interface MarkdownToolbarDeps {
  /** L('по-русски', 'in English') — локализованная подпись. */
  L(ru: string, en: string): string
  /** Обернуть выделение (или вставить плейсхолдер): surround('**','**','текст'). */
  surround(pre: string, post: string, placeholder: string): void
  /** Префикс к каждой строке выделения; i — индекс строки (нумерация). */
  linePrefix(prefix: (i: number) => string): void
}

export type ToolbarGroup = { icon: typeof Bold; t: string; run: () => void }[]

export function markdownToolbarGroups({ L, surround, linePrefix }: MarkdownToolbarDeps): ToolbarGroup[] {
  return [
    [
      { icon: Heading, t: L('заголовок', 'heading'), run: () => linePrefix(() => '### ') },
      { icon: Bold, t: `${L('жирный', 'bold')} (Ctrl+B)`, run: () => surround('**', '**', L('текст', 'text')) },
      { icon: Italic, t: `${L('курсив', 'italic')} (Ctrl+I)`, run: () => surround('_', '_', L('текст', 'text')) },
      { icon: Strikethrough, t: L('зачёркнутый', 'strikethrough'), run: () => surround('~~', '~~', L('текст', 'text')) },
    ],
    [
      { icon: Quote, t: L('цитата', 'quote'), run: () => linePrefix(() => '> ') },
      { icon: Code, t: L('код', 'code'), run: () => surround('`', '`', 'code') },
      { icon: Link2, t: `${L('ссылка', 'link')} (Ctrl+K)`, run: () => surround('[', '](url)', L('текст', 'text')) },
    ],
    [
      { icon: List, t: L('список', 'bulleted list'), run: () => linePrefix(() => '- ') },
      { icon: ListOrdered, t: L('нумерованный', 'numbered list'), run: () => linePrefix((i) => `${i + 1}. `) },
      { icon: ListChecks, t: L('чек-лист', 'task list'), run: () => linePrefix(() => '- [ ] ') },
    ],
  ]
}
