import { tr, trLoose, type Lang, type LocaleText } from '@/shared/i18n'

// Какое поле блока прокомментировано. Роль `path` из модели GitHub/GitLab: там
// комментарий адресуется файлом, у нас — блоком (block_id) и полем внутри него.
// Список закрытый: якорь должен уметь достать ровно тот текст, по которому его
// снимали, иначе пере-привязка сравнивает не то с тем.
export const COMMENT_FIELDS = ['title', 'desc', 'why', 'command', 'content.md'] as const
export type CommentField = (typeof COMMENT_FIELDS)[number]

export const isCommentField = (v: unknown): v is CommentField =>
  typeof v === 'string' && (COMMENT_FIELDS as readonly string[]).includes(v)

/** Минимум полей блока, нужный якорю (совместим со строкой steps). */
export interface AnchorableBlock {
  blockId?: string | null
  type?: string | null
  title?: LocaleText | null
  desc?: LocaleText | null
  why?: LocaleText | null
  command?: string | null
  content?: Record<string, unknown> | null
}

/**
 * Текст поля блока на языке зрителя — ровно та строка, в которой живёт якорь.
 * Пусто, если поля нет: тред тогда честно осиротеет, а не привяжется наугад.
 */
export function fieldText(block: AnchorableBlock, field: CommentField, lang: Lang): string {
  if (field === 'command') return block.command ?? ''
  if (field === 'content.md') return trLoose((block.content ?? {}).md, lang)
  const loc = field === 'title' ? block.title : field === 'desc' ? block.desc : block.why
  return loc ? tr(loc, lang) : ''
}
