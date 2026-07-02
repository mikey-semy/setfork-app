// Типы и конвертеры редактора пунктов. Редактор работает в ОДНОМ языке
// (текущий UI-язык), контент сохраняется как locale-JSON под этот код.
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ProposedItem } from '@/shared/db'

export type EditorRef = { label: string; url: string }
export type EditorItem = {
  title: string
  desc: string
  command: string
  imageKey: string // storage_key скриншота ('' — нет)
  imagePreview: string // отображаемый URL превью (imgproxy/objectURL); только клиент
  subtasks: string[]
  refs: EditorRef[]
}

export function emptyItem(): EditorItem {
  return { title: '', desc: '', command: '', imageKey: '', imagePreview: '', subtasks: [], refs: [] }
}

/** Плоские (одноязычные) пункты редактора → locale-JSON снимок. */
export function toProposedItems(items: EditorItem[], lang: Lang): ProposedItem[] {
  return items
    .filter((it) => it.title.trim())
    .map((it) => ({
      title: { [lang]: it.title.trim() },
      desc: it.desc.trim() ? { [lang]: it.desc.trim() } : {},
      command: it.command.trim(),
      hasImage: !!it.imageKey,
      imageKey: it.imageKey || undefined,
      subtasks: it.subtasks.filter((s) => s.trim()).map((s) => ({ [lang]: s.trim() })),
      refs: it.refs
        .filter((r) => r.label.trim())
        .map((r) => ({ label: { [lang]: r.label.trim() }, url: r.url.trim() || undefined })),
    }))
}

type LocaleItem = {
  title: LocaleText
  desc: LocaleText
  command: string
  hasImage: boolean
  imageKey?: string | null
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

/** Существующие пункты (locale-JSON) → плоские для префилла редактора.
 *  previews — карта imageKey → отображаемый URL (резолвится на сервере). */
export function toEditorItems(items: LocaleItem[], lang: Lang, previews: Record<string, string> = {}): EditorItem[] {
  return items.map((it) => ({
    title: tr(it.title, lang),
    desc: tr(it.desc, lang),
    command: it.command ?? '',
    imageKey: it.imageKey ?? '',
    imagePreview: it.imageKey ? (previews[it.imageKey] ?? '') : '',
    subtasks: (it.subtasks ?? []).map((s) => tr(s, lang)),
    refs: (it.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url ?? '' })),
  }))
}

/** Безопасный парс JSON из скрытого поля формы. */
export function parseEditorItems(raw: unknown): EditorItem[] {
  if (typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((it) => ({
      title: String(it?.title ?? ''),
      desc: String(it?.desc ?? ''),
      command: String(it?.command ?? ''),
      imageKey: String(it?.imageKey ?? ''),
      imagePreview: String(it?.imagePreview ?? ''),
      subtasks: Array.isArray(it?.subtasks) ? it.subtasks.map((s: unknown) => String(s)) : [],
      refs: Array.isArray(it?.refs)
        ? it.refs.map((r: { label?: unknown; url?: unknown }) => ({
            label: String(r?.label ?? ''),
            url: String(r?.url ?? ''),
          }))
        : [],
    }))
  } catch {
    return []
  }
}
