// Типы и конвертеры редактора пунктов. Редактор работает в ОДНОМ языке
// (текущий UI-язык), контент сохраняется как locale-JSON под этот код.
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ProposedItem, StepLevel } from '@/shared/db'
import { isBlockType, type BlockType } from './blocks'

const LEVELS: StepLevel[] = ['required', 'recommended', 'optional']
const asLevel = (v: unknown): StepLevel => (LEVELS.includes(v as StepLevel) ? (v as StepLevel) : 'required')
const asType = (v: unknown): BlockType => (typeof v === 'string' && isBlockType(v) ? v : 'step')

export type EditorRef = { label: string; url: string }
export type EditorItem = {
  // Блочная модель: 'step' (runnable/чекаемый) | 'text' (markdown) | 'image'.
  type: BlockType
  text: string // markdown text-блока ('' для не-text)
  caption: string // подпись image-блока
  title: string
  desc: string
  command: string
  imageKey: string // storage_key: скриншот шага ИЛИ картинка image-блока ('' — нет)
  imagePreview: string // отображаемый URL превью (imgproxy/objectURL); только клиент
  level: StepLevel
  why: string
  section: string // заголовок секции-группы ('' — без секции)
  subtasks: string[]
  refs: EditorRef[]
}

export function emptyItem(): EditorItem {
  return { type: 'step', text: '', caption: '', title: '', desc: '', command: '', imageKey: '', imagePreview: '', level: 'required', why: '', section: '', subtasks: [], refs: [] }
}

/** Пустой блок заданного типа (для инсертера). */
export function emptyBlock(type: BlockType): EditorItem {
  return { ...emptyItem(), type }
}

/** Шаг-блок ли (у него собственные поля; у text/image — content). */
export const isStepItem = (it: EditorItem): boolean => it.type === 'step'

/** Плоские (одноязычные) пункты редактора → locale-JSON снимок.
 *  Шаг без заголовка — мусор (отбрасываем); text/image валидны и без title. */
export function toProposedItems(items: EditorItem[], lang: Lang): ProposedItem[] {
  const base = { title: {} as LocaleText, desc: {} as LocaleText, command: '', hasImage: false, level: 'required' as StepLevel, why: {} as LocaleText, section: {} as LocaleText, subtasks: [] as LocaleText[], refs: [] as { label: LocaleText; url?: string }[] }
  return items
    .filter((it) => !isStepItem(it) || it.title.trim())
    .map((it): ProposedItem => {
      if (it.type === 'text') {
        return { ...base, type: 'text', content: { md: it.text.trim() } }
      }
      if (it.type === 'image') {
        return { ...base, type: 'image', hasImage: !!it.imageKey, content: { ref: it.imageKey || '', ...(it.caption.trim() ? { caption: it.caption.trim() } : {}) } }
      }
      return {
        title: { [lang]: it.title.trim() },
        desc: it.desc.trim() ? { [lang]: it.desc.trim() } : {},
        command: it.command.trim(),
        hasImage: !!it.imageKey,
        imageKey: it.imageKey || undefined,
        level: asLevel(it.level),
        why: it.why.trim() ? { [lang]: it.why.trim() } : {},
        section: it.section.trim() ? { [lang]: it.section.trim() } : {},
        subtasks: it.subtasks.filter((s) => s.trim()).map((s) => ({ [lang]: s.trim() })),
        refs: it.refs
          .filter((r) => r.label.trim())
          .map((r) => ({ label: { [lang]: r.label.trim() }, url: r.url.trim() || undefined })),
      }
    })
}

type LocaleItem = {
  type?: string
  content?: Record<string, unknown>
  title: LocaleText
  desc: LocaleText
  command: string
  hasImage: boolean
  imageKey?: string | null
  level?: StepLevel
  why?: LocaleText
  section?: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

/** Существующие пункты (locale-JSON) → плоские для префилла редактора.
 *  previews — карта imageKey → отображаемый URL (резолвится на сервере).
 *  Для image-блоков ключ картинки лежит в content.ref. */
export function toEditorItems(items: LocaleItem[], lang: Lang, previews: Record<string, string> = {}): EditorItem[] {
  return items.map((it): EditorItem => {
    const type = asType(it.type)
    if (type === 'text') {
      return { ...emptyItem(), type: 'text', text: typeof it.content?.md === 'string' ? it.content.md : '' }
    }
    if (type === 'image') {
      const ref = typeof it.content?.ref === 'string' ? it.content.ref : ''
      return { ...emptyItem(), type: 'image', imageKey: ref, imagePreview: ref ? (previews[ref] ?? '') : '', caption: typeof it.content?.caption === 'string' ? it.content.caption : '' }
    }
    return {
      type: 'step',
      text: '',
      caption: '',
      title: tr(it.title, lang),
      desc: tr(it.desc, lang),
      command: it.command ?? '',
      imageKey: it.imageKey ?? '',
      imagePreview: it.imageKey ? (previews[it.imageKey] ?? '') : '',
      level: asLevel(it.level),
      why: it.why ? tr(it.why, lang) : '',
      section: it.section ? tr(it.section, lang) : '',
      subtasks: (it.subtasks ?? []).map((s) => tr(s, lang)),
      refs: (it.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url ?? '' })),
    }
  })
}

/** Безопасный парс JSON из скрытого поля формы. */
export function parseEditorItems(raw: unknown): EditorItem[] {
  if (typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((it) => ({
      type: asType(it?.type),
      text: String(it?.text ?? ''),
      caption: String(it?.caption ?? ''),
      title: String(it?.title ?? ''),
      desc: String(it?.desc ?? ''),
      command: String(it?.command ?? ''),
      imageKey: String(it?.imageKey ?? ''),
      imagePreview: String(it?.imagePreview ?? ''),
      level: asLevel(it?.level),
      why: String(it?.why ?? ''),
      section: String(it?.section ?? ''),
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
