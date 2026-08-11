import { Bold, Code, Heading, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { TextOps } from './use-text-ops'

// Общие markdown-команды тулбара — единый набор для MarkdownEditor и
// BubbleTextEditor (списки кнопок дрейфовали: разошёлся порядок 2-й группы).

export type ToolbarGroup = { icon: typeof Bold; t: string; run: () => void }[]

/**
 * Кнопки по группам: от частого к редкому. Подписи — из словаря, действия — из общей
 * механики правки текста (`useTextOps`), поэтому обе панели делают ровно одно и то же.
 */
export function markdownToolbarGroups({ surround, linePrefix }: Pick<TextOps, 'surround' | 'linePrefix'>, lang: Lang): ToolbarGroup[] {
  const ph = t('editor.textPlaceholder', lang)
  return [
    [
      { icon: Heading, t: t('editor.heading', lang), run: () => linePrefix(() => '### ') },
      { icon: Bold, t: `${t('editor.bold', lang)} (Ctrl+B)`, run: () => surround('**', '**', ph) },
      { icon: Italic, t: `${t('editor.italic', lang)} (Ctrl+I)`, run: () => surround('_', '_', ph) },
      { icon: Strikethrough, t: t('editor.strikethrough', lang), run: () => surround('~~', '~~', ph) },
    ],
    [
      { icon: Quote, t: t('editor.quote', lang), run: () => linePrefix(() => '> ') },
      { icon: Code, t: t('editor.code', lang), run: () => surround('`', '`', 'code') },
      { icon: Link2, t: `${t('editor.link', lang)} (Ctrl+K)`, run: () => surround('[', '](url)', ph) },
    ],
    [
      { icon: List, t: t('editor.bulletedList', lang), run: () => linePrefix(() => '- ') },
      { icon: ListOrdered, t: t('editor.numberedList', lang), run: () => linePrefix((i) => `${i + 1}. `) },
      { icon: ListChecks, t: t('editor.taskList', lang), run: () => linePrefix(() => '- [ ] ') },
    ],
  ]
}
