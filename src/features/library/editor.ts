// Типы и конвертеры редактора пунктов. Редактор работает в ОДНОМ языке
// (текущий UI-язык), контент сохраняется как locale-JSON под этот код.
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ProposedItem, StepLevel } from '@/shared/db'
import { blankCount, isBlockType, newBlockId, newOptionId, type BlockType, type QuizKind } from './blocks'

const QUIZ_KINDS: QuizKind[] = ['choice', 'text', 'number', 'blank', 'match']
const asQuizKind = (v: unknown): QuizKind => (QUIZ_KINDS.includes(v as QuizKind) ? (v as QuizKind) : 'choice')

const LEVELS: StepLevel[] = ['required', 'recommended', 'optional']
const asLevel = (v: unknown): StepLevel => (LEVELS.includes(v as StepLevel) ? (v as StepLevel) : 'required')
const asType = (v: unknown): BlockType => (typeof v === 'string' && isBlockType(v) ? v : 'step')

export type EditorRef = { label: string; url: string }
export type EditorOption = { id: string; text: string }
export type EditorPoll = { question: string; options: EditorOption[]; multi: boolean; deadline: string }
export type EditorQuizOption = { id: string; text: string; correct: boolean }
// В редакторе держим поля ВСЕХ типов теста; сериализуем по kind. Числа — строками
// (парсим при сохранении); accept — список принимаемых текстовых ответов.
export type EditorQuiz = {
  kind: QuizKind
  question: string
  options: EditorQuizOption[]
  multi: boolean
  accept: string[]
  caseSensitive: boolean
  answer: string
  tolerance: string
  template: string // blank: текст с пропусками '___'
  blanks: string[] // blank: на каждый пропуск — принимаемые ответы через запятую
  pairs: { left: string; right: string }[] // match: пары для сопоставления
  explain: string
}
export type EditorItem = {
  // Блочная модель: 'step' (runnable/чекаемый) | 'text' (markdown) | 'image' | 'poll'.
  type: BlockType
  bid: string // стабильный id не-step блока (для merge); '' у шага. Живёт в content.bid.
  text: string // markdown text-блока ('' для не-text)
  caption: string // подпись image/video-блока
  videoUrl: string // ссылка video-блока ('' для не-video)
  fileUrl: string // ссылка file-блока ('' для не-file)
  fileName: string // имя файла file-блока
  poll: EditorPoll // данные poll-блока (пусто для не-poll)
  quiz: EditorQuiz // данные quiz-блока (пусто для не-quiz)
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

const emptyPoll = (): EditorPoll => ({ question: '', options: [], multi: false, deadline: '' })
const emptyQuiz = (): EditorQuiz => ({ kind: 'choice', question: '', options: [], multi: false, accept: [], caseSensitive: false, answer: '', tolerance: '', template: '', blanks: [], pairs: [], explain: '' })

export function emptyItem(): EditorItem {
  return { type: 'step', bid: '', text: '', caption: '', videoUrl: '', fileUrl: '', fileName: '', poll: emptyPoll(), quiz: emptyQuiz(), title: '', desc: '', command: '', imageKey: '', imagePreview: '', level: 'required', why: '', section: '', subtasks: [], refs: [] }
}

/** Пустой блок заданного типа (для инсертера). Не-step получает стабильный bid;
 *  poll/quiz заводятся с двумя пустыми вариантами. */
export function emptyBlock(type: BlockType): EditorItem {
  const base = { ...emptyItem(), type, bid: type === 'step' ? '' : newBlockId() }
  if (type === 'poll') base.poll = { question: '', options: [{ id: newOptionId(), text: '' }, { id: newOptionId(), text: '' }], multi: false, deadline: '' }
  if (type === 'quiz') base.quiz = { ...emptyQuiz(), options: [{ id: newOptionId(), text: '', correct: false }, { id: newOptionId(), text: '', correct: false }], accept: [''] }
  return base
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
      // Секция/урок — у любого блока (группирует блоки ниже в урок курса).
      const sec: LocaleText = it.section.trim() ? { [lang]: it.section.trim() } : {}
      // bid — стабильный id блока (для merge), кладём в content; гарантируем наличие.
      if (it.type === 'text') {
        return { ...base, section: sec, type: 'text', content: { md: it.text.trim(), bid: it.bid || newBlockId() } }
      }
      if (it.type === 'image') {
        return { ...base, section: sec, type: 'image', hasImage: !!it.imageKey, content: { ref: it.imageKey || '', ...(it.caption.trim() ? { caption: it.caption.trim() } : {}), bid: it.bid || newBlockId() } }
      }
      if (it.type === 'video') {
        return { ...base, section: sec, type: 'video', content: { url: it.videoUrl.trim(), ...(it.caption.trim() ? { caption: it.caption.trim() } : {}), bid: it.bid || newBlockId() } }
      }
      if (it.type === 'file') {
        return { ...base, section: sec, type: 'file', content: { url: it.fileUrl.trim(), name: it.fileName.trim(), bid: it.bid || newBlockId() } }
      }
      if (it.type === 'poll') {
        const options = it.poll.options
          .filter((o) => o.text.trim())
          .map((o) => ({ id: o.id || newOptionId(), text: o.text.trim() }))
        return {
          ...base,
          section: sec,
          type: 'poll',
          content: {
            bid: it.bid || newBlockId(),
            question: it.poll.question.trim(),
            options,
            ...(it.poll.multi ? { multi: true } : {}),
            ...(it.poll.deadline.trim() ? { deadline: it.poll.deadline.trim() } : {}),
          },
        }
      }
      if (it.type === 'quiz') {
        const q = it.quiz
        const common = {
          bid: it.bid || newBlockId(),
          question: q.question.trim(),
          // kind опускаем для 'choice' — байт-совместимость со старыми quiz.
          ...(q.kind !== 'choice' ? { kind: q.kind } : {}),
          ...(q.explain.trim() ? { explain: q.explain.trim() } : {}),
        }
        let content: Record<string, unknown>
        if (q.kind === 'text') {
          content = {
            ...common,
            accept: q.accept.map((a) => a.trim()).filter(Boolean),
            ...(q.caseSensitive ? { caseSensitive: true } : {}),
          }
        } else if (q.kind === 'number') {
          content = {
            ...common,
            answer: Number(q.answer),
            ...(q.tolerance.trim() && Number(q.tolerance) ? { tolerance: Number(q.tolerance) } : {}),
          }
        } else if (q.kind === 'blank') {
          const n = blankCount(q.template)
          content = {
            ...common,
            template: q.template,
            // По пропуску — принимаемые ответы (через запятую → массив).
            blanks: Array.from({ length: n }, (_, i) => (q.blanks[i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
            ...(q.caseSensitive ? { caseSensitive: true } : {}),
          }
        } else if (q.kind === 'match') {
          content = {
            ...common,
            pairs: q.pairs.map((p) => ({ left: p.left.trim(), right: p.right.trim() })).filter((p) => p.left && p.right),
            ...(q.caseSensitive ? { caseSensitive: true } : {}),
          }
        } else {
          const options = q.options
            .filter((o) => o.text.trim())
            .map((o) => ({ id: o.id || newOptionId(), text: o.text.trim(), ...(o.correct ? { correct: true } : {}) }))
          content = { ...common, options, ...(q.multi ? { multi: true } : {}) }
        }
        return { ...base, section: sec, type: 'quiz', content }
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
    const bid = typeof it.content?.bid === 'string' ? it.content.bid : ''
    const section = it.section ? tr(it.section, lang) : '' // секция/урок — у любого блока
    if (type === 'text') {
      return { ...emptyItem(), type: 'text', bid, section, text: typeof it.content?.md === 'string' ? it.content.md : '' }
    }
    if (type === 'image') {
      const ref = typeof it.content?.ref === 'string' ? it.content.ref : ''
      return { ...emptyItem(), type: 'image', bid, section, imageKey: ref, imagePreview: ref ? (previews[ref] ?? '') : '', caption: typeof it.content?.caption === 'string' ? it.content.caption : '' }
    }
    if (type === 'video') {
      return { ...emptyItem(), type: 'video', bid, section, videoUrl: typeof it.content?.url === 'string' ? it.content.url : '', caption: typeof it.content?.caption === 'string' ? it.content.caption : '' }
    }
    if (type === 'file') {
      return { ...emptyItem(), type: 'file', bid, section, fileUrl: typeof it.content?.url === 'string' ? it.content.url : '', fileName: typeof it.content?.name === 'string' ? it.content.name : '' }
    }
    if (type === 'poll') {
      const c = it.content ?? {}
      const rawOpts = Array.isArray(c.options) ? (c.options as unknown[]) : []
      const options = rawOpts.map((o) => {
        const oo = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
        return { id: typeof oo.id === 'string' ? oo.id : newOptionId(), text: typeof oo.text === 'string' ? oo.text : '' }
      })
      return {
        ...emptyItem(),
        type: 'poll',
        bid,
        section,
        poll: {
          question: typeof c.question === 'string' ? c.question : '',
          options: options.length ? options : [{ id: newOptionId(), text: '' }, { id: newOptionId(), text: '' }],
          multi: c.multi === true,
          deadline: typeof c.deadline === 'string' ? c.deadline : '',
        },
      }
    }
    if (type === 'quiz') {
      const c = it.content ?? {}
      const kind = asQuizKind(c.kind)
      const rawOpts = Array.isArray(c.options) ? (c.options as unknown[]) : []
      const options = rawOpts.map((o) => {
        const oo = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
        return { id: typeof oo.id === 'string' ? oo.id : newOptionId(), text: typeof oo.text === 'string' ? oo.text : '', correct: oo.correct === true }
      })
      const accept = Array.isArray(c.accept) ? (c.accept as unknown[]).map((a) => String(a)) : []
      const rawBlanks = Array.isArray(c.blanks) ? (c.blanks as unknown[]) : []
      const blanks = rawBlanks.map((b) => (Array.isArray(b) ? (b as unknown[]).map((x) => String(x)).join(', ') : String(b)))
      const pairs = Array.isArray(c.pairs)
        ? (c.pairs as unknown[]).map((p) => {
            const pp = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
            return { left: typeof pp.left === 'string' ? pp.left : '', right: typeof pp.right === 'string' ? pp.right : '' }
          })
        : []
      return {
        ...emptyItem(),
        type: 'quiz',
        bid,
        section,
        quiz: {
          kind,
          question: typeof c.question === 'string' ? c.question : '',
          options: options.length ? options : [{ id: newOptionId(), text: '', correct: false }, { id: newOptionId(), text: '', correct: false }],
          multi: c.multi === true,
          accept: accept.length ? accept : [''],
          caseSensitive: c.caseSensitive === true,
          answer: typeof c.answer === 'number' ? String(c.answer) : '',
          tolerance: typeof c.tolerance === 'number' ? String(c.tolerance) : '',
          template: typeof c.template === 'string' ? c.template : '',
          blanks,
          pairs: pairs.length ? pairs : [{ left: '', right: '' }, { left: '', right: '' }],
          explain: typeof c.explain === 'string' ? c.explain : '',
        },
      }
    }
    return {
      type: 'step',
      bid: '',
      text: '',
      caption: '',
      videoUrl: '',
      fileUrl: '',
      fileName: '',
      poll: emptyPoll(),
      quiz: emptyQuiz(),
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
      bid: String(it?.bid ?? ''),
      text: String(it?.text ?? ''),
      caption: String(it?.caption ?? ''),
      videoUrl: String(it?.videoUrl ?? ''),
      fileUrl: String(it?.fileUrl ?? ''),
      fileName: String(it?.fileName ?? ''),
      poll: {
        question: String(it?.poll?.question ?? ''),
        options: Array.isArray(it?.poll?.options)
          ? it.poll.options.map((o: { id?: unknown; text?: unknown }) => ({ id: String(o?.id ?? '') || newOptionId(), text: String(o?.text ?? '') }))
          : [],
        multi: it?.poll?.multi === true,
        deadline: String(it?.poll?.deadline ?? ''),
      },
      quiz: {
        kind: asQuizKind(it?.quiz?.kind),
        question: String(it?.quiz?.question ?? ''),
        options: Array.isArray(it?.quiz?.options)
          ? it.quiz.options.map((o: { id?: unknown; text?: unknown; correct?: unknown }) => ({ id: String(o?.id ?? '') || newOptionId(), text: String(o?.text ?? ''), correct: o?.correct === true }))
          : [],
        multi: it?.quiz?.multi === true,
        accept: Array.isArray(it?.quiz?.accept) ? it.quiz.accept.map((a: unknown) => String(a)) : [],
        caseSensitive: it?.quiz?.caseSensitive === true,
        answer: String(it?.quiz?.answer ?? ''),
        tolerance: String(it?.quiz?.tolerance ?? ''),
        template: String(it?.quiz?.template ?? ''),
        blanks: Array.isArray(it?.quiz?.blanks) ? it.quiz.blanks.map((b: unknown) => String(b)) : [],
        pairs: Array.isArray(it?.quiz?.pairs)
          ? it.quiz.pairs.map((p: { left?: unknown; right?: unknown }) => ({ left: String(p?.left ?? ''), right: String(p?.right ?? '') }))
          : [],
        explain: String(it?.quiz?.explain ?? ''),
      },
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
