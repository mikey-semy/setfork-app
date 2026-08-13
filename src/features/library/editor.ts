// Типы и конвертеры редактора пунктов. Редактор работает в ОДНОМ языке
// (текущий UI-язык), контент сохраняется как locale-JSON под этот код.
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ProposedItem, StepLevel } from '@/shared/db'
import { blankCount, type QuizKind } from '@/core'
import { asBlockType, isBlockType, isBlockUuid, newBlockId, newOptionId, PRODUCT_TIERS, type BlockType, type ProductTier } from './blocks'
import { safeHref } from '@/shared/lib/safe-url'

const QUIZ_KINDS: QuizKind[] = ['choice', 'text', 'number', 'blank', 'match', 'sort', 'code']
const asQuizKind = (v: unknown): QuizKind => (QUIZ_KINDS.includes(v as QuizKind) ? (v as QuizKind) : 'choice')

const LEVELS: StepLevel[] = ['required', 'recommended', 'optional']
const asLevel = (v: unknown): StepLevel => (LEVELS.includes(v as StepLevel) ? (v as StepLevel) : 'required')

export type EditorRef = { label: string; url: string }
// Товар product-блока; tier '' = без яруса.
export type EditorProduct = { name: string; url: string; tier: '' | ProductTier; note: string }
/** Пустой товар — рядом с типом, а не в компоненте окна: заводит его и блок, и окно. */
export const EMPTY_PRODUCT: EditorProduct = { name: '', url: '', tier: '', note: '' }
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
  items: string[] // sort: элементы в правильном порядке
  explain: string
}
/**
 * Поля блока, которые правит ИИ по инструкции из чата. Именно поля, а не весь
 * EditorItem: у блока в редакторе есть своя идентичность, загруженная картинка и
 * голоса опроса — правка текста их трогать не должна.
 */
export type EditorBlockPatch = Pick<EditorItem, 'title' | 'desc' | 'command' | 'level' | 'why' | 'needsHuman' | 'needsHumanAsk' | 'subtasks' | 'refs'>

export type EditorItem = {
  // Блочная модель: 'step' (runnable/чекаемый) | 'text' (markdown) | 'image' | 'poll'.
  type: BlockType
  // Стабильный id блока СКВОЗЬ версии — у любого типа, включая шаг. Для не-step
  // дублируется в content.bid (так его видит git-merge и голоса опросов), для
  // шага живёт только в колонке steps.block_id: класть его в content шага нельзя,
  // это сломало бы байт-в-байт golden-паритет list.json с Rust.
  bid: string
  /**
   * Идентичность из КОЛОНКИ `steps.block_id`, отдельно от `bid`.
   *
   * Разделены, потому что у легаси-блоков это РАЗНЫЕ значения и обоим надо
   * выжить. `bid` уезжает в `content.bid` (его знает git-merge), колонка живёт
   * своей жизнью. Пока поле было одно, каждое сохранение выбирало между ними и
   * теряло второе:
   *   • взять колонку — легаси-алиас перезаписывался uuid'ом, и сравнение с
   *     ранними версиями снова давало «удалён + добавлен» (D4 линзы 05);
   *   • взять алиас — `blockId: isBlockUuid(bid) ? bid : newBlockId()` ниже
   *     генерировал НОВЫЙ uuid при каждом сохранении, то есть идентичность в
   *     БД становилась нестабильной, что ещё хуже.
   * Пусто у новых блоков и у строк, записанных до ADR-0013.
   */
  blockId?: string
  text: string // markdown text-блока ('' для не-text)
  caption: string // подпись image/video-блока
  videoUrl: string // ссылка video-блока ('' для не-video)
  fileUrl: string // ссылка file-блока ('' для не-file)
  fileName: string // имя файла file-блока
  poll: EditorPoll // данные poll-блока (пусто для не-poll)
  quiz: EditorQuiz // данные quiz-блока (пусто для не-quiz)
  products: EditorProduct[] // товары product-блока (caption = заголовок подборки)
  title: string
  desc: string
  command: string
  imageKey: string // storage_key: скриншот шага ИЛИ картинка image-блока ('' — нет)
  imagePreview: string // отображаемый URL превью (imgproxy/objectURL); только клиент
  level: StepLevel
  why: string
  /** «Здесь нужен человек»: машина не может знать — местные цены, вкус, личный опыт. */
  needsHuman: boolean
  /** Что спросить у человека ('' → общий текст приглашения). */
  needsHumanAsk: string
  /** Разрушительный пункт: команда необратима — в собранный скрипт попадёт
   *  закомментированной. undefined = автор не решал: значение берётся по шаблону
   *  команды. Явные true/false — решение автора, детектор его не переспорит. */
  danger?: boolean
  section: string // заголовок секции-группы ('' — без секции)
  subtasks: string[]
  refs: EditorRef[]
}

const emptyPoll = (): EditorPoll => ({ question: '', options: [], multi: false, deadline: '' })
const emptyQuiz = (): EditorQuiz => ({ kind: 'choice', question: '', options: [], multi: false, accept: [], caseSensitive: false, answer: '', tolerance: '', template: '', blanks: [], pairs: [], items: [], explain: '' })

export function emptyItem(): EditorItem {
  return { type: 'step', bid: '', text: '', caption: '', videoUrl: '', fileUrl: '', fileName: '', poll: emptyPoll(), quiz: emptyQuiz(), products: [], title: '', desc: '', command: '', imageKey: '', imagePreview: '', level: 'required', why: '', needsHuman: false, needsHumanAsk: '', section: '', subtasks: [], refs: [] }
}

/** Пустой блок заданного типа (для инсертера). Стабильный bid получает ЛЮБОЙ
 *  блок, включая шаг: по нему дифф понимает «это тот же пункт, его переименовали»,
 *  а не «удалили и добавили». poll/quiz заводятся с двумя пустыми вариантами;
 *  товары — пустым списком: они показаны чипами, и пустой чип читался бы как
 *  «товар без названия», а не как приглашение ввести первый. */
export function emptyBlock(type: BlockType): EditorItem {
  const base = { ...emptyItem(), type, bid: newBlockId() }
  if (type === 'poll') base.poll = { question: '', options: [{ id: newOptionId(), text: '' }, { id: newOptionId(), text: '' }], multi: false, deadline: '' }
  if (type === 'quiz') base.quiz = { ...emptyQuiz(), options: [{ id: newOptionId(), text: '', correct: false }, { id: newOptionId(), text: '', correct: false }], accept: [''] }
  return base
}

/** Шаг-блок ли (у него собственные поля; у text/image — content). */
export const isStepItem = (it: EditorItem): boolean => it.type === 'step'

/** Плоские (одноязычные) пункты редактора → locale-JSON снимок.
 *  Шаг без заголовка — мусор (отбрасываем); text/image валидны и без title. */
export function toProposedItems(items: EditorItem[], lang: Lang): ProposedItem[] {
  const base = { title: {} as LocaleText, desc: {} as LocaleText, command: '', hasImage: false, level: 'required' as StepLevel, why: {} as LocaleText, needsHuman: false, needsHumanAsk: {} as LocaleText, section: {} as LocaleText, subtasks: [] as LocaleText[], refs: [] as { label: LocaleText; url?: string }[] }
  const kept = items.filter((it) => !isStepItem(it) || it.title.trim())
  // Стабильный blockId проставляем ОДНИМ местом поверх всех веток: у не-step он
  // заодно лежит в content.bid (git-merge, голоса), у шага — только здесь.
  return kept
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
        // Санитизируем схему на записи (второй рубеж к SafeLink на рендере): javascript:/data: → ''.
        return { ...base, section: sec, type: 'video', content: { url: safeHref(it.videoUrl), ...(it.caption.trim() ? { caption: it.caption.trim() } : {}), bid: it.bid || newBlockId() } }
      }
      if (it.type === 'file') {
        return { ...base, section: sec, type: 'file', content: { url: safeHref(it.fileUrl), name: it.fileName.trim(), bid: it.bid || newBlockId() } }
      }
      if (it.type === 'product') {
        // Товар без имени или ссылки — мусор; url санитизируем на записи (второй
        // рубеж к SafeLink). caption редактора = заголовок подборки.
        const items = it.products
          .map((p) => ({ name: p.name.trim(), url: safeHref(p.url), tier: p.tier, note: p.note.trim() }))
          .filter((p) => p.name && p.url)
          .map((p) => ({
            name: p.name,
            url: p.url,
            ...(p.tier && PRODUCT_TIERS.includes(p.tier) ? { tier: p.tier } : {}),
            ...(p.note ? { note: p.note } : {}),
          }))
        return {
          ...base,
          section: sec,
          type: 'product',
          content: { bid: it.bid || newBlockId(), ...(it.caption.trim() ? { title: it.caption.trim() } : {}), items },
        }
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
        } else if (q.kind === 'sort') {
          content = {
            ...common,
            items: q.items.map((s) => s.trim()).filter(Boolean),
            ...(q.caseSensitive ? { caseSensitive: true } : {}),
          }
        } else if (q.kind === 'code') {
          content = {
            ...common,
            accept: q.accept.map((a) => a.trim()).filter(Boolean),
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
        // Снял галочку — пометка уходит вместе с вопросом: «человек ответил» и есть
        // единственный способ её закрыть.
        needsHuman: it.needsHuman,
        needsHumanAsk: it.needsHuman && it.needsHumanAsk.trim() ? { [lang]: it.needsHumanAsk.trim() } : {},
        // Пометка «разрушительный пункт» едет как решение автора — включая снятое.
        // Дальше её досматривает toStepInput: не заданную ставит по шаблону команды.
        danger: it.danger,
        section: it.section.trim() ? { [lang]: it.section.trim() } : {},
        subtasks: it.subtasks.filter((s) => s.trim()).map((s) => ({ [lang]: s.trim() })),
        // url санитизируем на записи, как у video/file/product (второй рубеж к
        // SafeLink): ссылки шага теперь принимает и MCP, а не только редактор.
        // Ссылка живёт, если есть ХОТЬ ЧТО-ТО: раньше выживала только та, у которой
        // написана подпись, и «просто ссылка» молча пропадала при сохранении
        // (жалоба владельца 04.08.2026 про обязательный label в API). Подпись теперь
        // не обязательна — интерфейс покажет домен (shared/lib/link-label).
        refs: it.refs
          .filter((r) => r.label.trim() || r.url.trim())
          .map((r) => ({ label: r.label.trim() ? { [lang]: r.label.trim() } : {}, url: safeHref(r.url) || undefined })),
      }
    })
    // В колонку block_id (тип uuid) кладём ТОЛЬКО uuid: идентичность приходит и
    // снаружи (API, импорт), а нераспознанное значение уронило бы вставку шагов —
    // у черновика она идёт после удаления старых, и список остался бы пустым.
    // Легаси-bid (не-uuid) при этом живёт дальше в content.bid, как и жил.
    // Колонка — из своего поля; вывести её из `bid` нельзя: у легаси-блока там
    // не-uuid, и `newBlockId()` выдавал бы НОВЫЙ идентификатор при каждом
    // сохранении. Если колонки ещё нет, uuid рождается один раз: дальше он
    // приезжает из БД через toEditorItems. D4 линзы 05.
    .map((p, i) => {
      const kept_i = kept[i]
      // Оба источника проверяем на uuid: колонка `steps.block_id` типа uuid, а
      // значения приходят и снаружи (скрытое поле формы, API, импорт) — любое
      // нераспознанное уронило бы вставку шагов, а у черновика она идёт ПОСЛЕ
      // удаления старых, то есть список остался бы пустым. Замечание авто-ревью.
      const fromColumn = isBlockUuid(kept_i.blockId ?? '') ? kept_i.blockId! : ''
      const column = fromColumn || (isBlockUuid(kept_i.bid) ? kept_i.bid : newBlockId())
      return { ...p, blockId: column }
    })
}

type LocaleItem = {
  type?: string
  blockId?: string | null
  content?: Record<string, unknown>
  title: LocaleText
  desc: LocaleText
  command: string
  hasImage: boolean
  imageKey?: string | null
  level?: StepLevel
  why?: LocaleText
  needsHuman?: boolean
  needsHumanAsk?: LocaleText
  danger?: boolean
  section?: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

/** Существующие пункты (locale-JSON) → плоские для префилла редактора.
 *  previews — карта imageKey → отображаемый URL (резолвится на сервере).
 *  Для image-блоков ключ картинки лежит в content.ref. */
export function toEditorItems(items: LocaleItem[], lang: Lang, previews: Record<string, string> = {}): EditorItem[] {
  return items.map((it): EditorItem => {
    const type = asBlockType(it.type)
    // Идентичность: колонка block_id — источник правды; content.bid — легаси-дом
    // не-step блоков (и то, что переживает git-round-trip). Пусто у старых строк.
    // Алиас payload'а и колонка — ПОРОЗНЬ (см. EditorItem.blockId). Раньше здесь
    // выбиралось одно значение, и второе терялось на записи.
    const legacyBid = typeof it.content?.bid === 'string' ? it.content.bid : ''
    const bid = legacyBid || it.blockId || ''
    const blockId = it.blockId || ''
    const section = it.section ? tr(it.section, lang) : '' // секция/урок — у любого блока
    if (type === 'text') {
      return { ...emptyItem(), type: 'text', bid, blockId, section, text: typeof it.content?.md === 'string' ? it.content.md : '' }
    }
    if (type === 'image') {
      const ref = typeof it.content?.ref === 'string' ? it.content.ref : ''
      return { ...emptyItem(), type: 'image', bid, blockId, section, imageKey: ref, imagePreview: ref ? (previews[ref] ?? '') : '', caption: typeof it.content?.caption === 'string' ? it.content.caption : '' }
    }
    if (type === 'video') {
      return { ...emptyItem(), type: 'video', bid, blockId, section, videoUrl: typeof it.content?.url === 'string' ? it.content.url : '', caption: typeof it.content?.caption === 'string' ? it.content.caption : '' }
    }
    if (type === 'file') {
      return { ...emptyItem(), type: 'file', bid, blockId, section, fileUrl: typeof it.content?.url === 'string' ? it.content.url : '', fileName: typeof it.content?.name === 'string' ? it.content.name : '' }
    }
    if (type === 'product') {
      const c = it.content ?? {}
      const rawItems = Array.isArray(c.items) ? (c.items as unknown[]) : []
      const products = rawItems.map((p) => {
        const pp = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
        return {
          name: typeof pp.name === 'string' ? pp.name : '',
          url: typeof pp.url === 'string' ? pp.url : '',
          tier: typeof pp.tier === 'string' && (PRODUCT_TIERS as string[]).includes(pp.tier) ? (pp.tier as ProductTier) : ('' as const),
          note: typeof pp.note === 'string' ? pp.note : '',
        }
      })
      return {
        ...emptyItem(),
        type: 'product',
        bid,
        blockId,
        section,
        caption: typeof c.title === 'string' ? c.title : '',
        // Пустой строки-заготовки быть не должно: товары теперь чипы, и пустой
        // чип читается как «товар без названия», а не как приглашение к вводу.
        products,
      }
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
        blockId,
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
        blockId,
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
          items: Array.isArray(c.items) ? (c.items as unknown[]).map((x) => String(x)) : [],
          explain: typeof c.explain === 'string' ? c.explain : '',
        },
      }
    }
    return {
      type: 'step',
      bid, // шаг тоже несёт идентичность сквозь версии (пусто у строк до block_id)
      blockId,
      text: '',
      caption: '',
      videoUrl: '',
      fileUrl: '',
      fileName: '',
      poll: emptyPoll(),
      quiz: emptyQuiz(),
      products: [],
      title: tr(it.title, lang),
      desc: tr(it.desc, lang),
      command: it.command ?? '',
      imageKey: it.imageKey ?? '',
      imagePreview: it.imageKey ? (previews[it.imageKey] ?? '') : '',
      level: asLevel(it.level),
      why: it.why ? tr(it.why, lang) : '',
      needsHuman: it.needsHuman === true,
      needsHumanAsk: it.needsHumanAsk ? tr(it.needsHumanAsk, lang) : '',
      // Сохранённое значение — это уже решение автора (или авто-простановка на
      // прошлой записи), поэтому читаем как есть.
      danger: it.danger === true,
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
      type: asBlockType(it?.type),
      bid: String(it?.bid ?? ''),
      // Колонка `steps.block_id` — ОТДЕЛЬНО от алиаса payload'а. Через этот
      // парсер идёт КАЖДОЕ обычное сохранение (ListEditor кладёт элементы в
      // скрытое поле формы, серверные действия читают их отсюда), поэтому без
      // переноса `blockId` разделение полей ничего не даёт: у легаси-блока
      // `newBlockId()` снова срабатывал бы на каждом сохранении. Замечание
      // авто-ревью на fe#780 (P1).
      blockId: it?.blockId ? String(it.blockId) : undefined,
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
        items: Array.isArray(it?.quiz?.items) ? it.quiz.items.map((s: unknown) => String(s)) : [],
        explain: String(it?.quiz?.explain ?? ''),
      },
      products: Array.isArray(it?.products)
        ? it.products.map((p: { name?: unknown; url?: unknown; tier?: unknown; note?: unknown }) => ({
            name: String(p?.name ?? ''),
            url: String(p?.url ?? ''),
            tier: typeof p?.tier === 'string' && (PRODUCT_TIERS as string[]).includes(p.tier) ? (p.tier as ProductTier) : ('' as const),
            note: String(p?.note ?? ''),
          }))
        : [],
      title: String(it?.title ?? ''),
      desc: String(it?.desc ?? ''),
      command: String(it?.command ?? ''),
      imageKey: String(it?.imageKey ?? ''),
      imagePreview: String(it?.imagePreview ?? ''),
      level: asLevel(it?.level),
      why: String(it?.why ?? ''),
      needsHuman: it?.needsHuman === true,
      needsHumanAsk: String(it?.needsHumanAsk ?? ''),
      // Тристейт переживает форму: пришло не-boolean — «автор не решал».
      danger: typeof it?.danger === 'boolean' ? it.danger : undefined,
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
