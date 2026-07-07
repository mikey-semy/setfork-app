// Типы блоков списка (всё-блочная модель). Чистый модуль без server-only —
// используется и на сервере, и в редакторе. См. дизайн-док по блочному редактору.

export const BLOCK_TYPES = ['step', 'text', 'image', 'poll', 'video', 'quiz', 'file'] as const
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
// Poll-блок: варианты (в git, версионируются) + голоса ВНЕ git (таблица poll_votes).
// Расширяемо под тесты/курсы: correct?, explanation, kind можно добавить позже.
export interface PollOption {
  id: string // стабильный id варианта — на него ссылаются голоса
  text: string
}
export interface PollBlockContent {
  bid?: string // стабильный id блока (как у всех не-step)
  question: string
  options: PollOption[]
  multi?: boolean // мульти-выбор (иначе один вариант)
  deadline?: string // ISO-дата; после неё голосование закрыто ('' / отсутствует — бессрочно)
}
// Video-блок: ссылка на видео (YouTube/Vimeo/прямой файл) + подпись.
export interface VideoBlockContent {
  bid?: string
  url: string
  caption?: string
}
// File-блок: вложение (PDF/архив/…) — ссылка + имя файла. Загрузка через
// uploadAttachmentFile (диск, 25МБ, белый список расширений). Отдаётся ссылкой на скачивание.
export interface FileBlockContent {
  bid?: string
  url: string
  name: string
}
// Quiz-блок (тест как на Stepik): вопрос + варианты с пометкой правильных.
// Проверка — на КЛИЕНТЕ (self-check): ответы лежат в content и версионируются
// в git вместе со списком (список всё равно форкается целиком — прятать ответы
// на сервере в v0 бессмысленно). Серверная оценка/прогресс — отдельный слайс (runs).
export interface QuizOption {
  id: string
  text: string
  correct?: boolean // помечен как верный (используется при проверке)
}
// Тип теста. undefined = 'choice' (обратная совместимость со старыми quiz).
export type QuizKind = 'choice' | 'text' | 'number' | 'blank' | 'match'
export interface QuizPair {
  left: string
  right: string
}
export interface QuizBlockContent {
  bid?: string
  kind?: QuizKind
  question: string
  explain?: string // пояснение, показывается после проверки
  // choice — выбор варианта(ов)
  options?: QuizOption[]
  multi?: boolean // несколько верных (иначе ровно один)
  // text — свободный короткий ответ (сверяется со списком принимаемых)
  accept?: string[]
  caseSensitive?: boolean // общий для text/blank/match
  // number — числовой ответ с допуском
  answer?: number
  tolerance?: number
  // blank — текст с пропусками ('___'); blanks[i] = принимаемые ответы i-го пропуска
  template?: string
  blanks?: string[][]
  // match — сопоставление пар (эталон). После стрипа для клиента: lefts + rights
  // (rights отсортированы, чтобы не выдавать правильную привязку).
  pairs?: QuizPair[]
  lefts?: string[]
  rights?: string[]
}

export const quizKind = (c: QuizBlockContent): QuizKind => c.kind ?? 'choice'

// Маркер пропуска в blank-шаблоне (три подчёркивания).
export const BLANK_MARK = '___'
/** Текст blank-шаблона → сегменты между пропусками (длина = число пропусков + 1). */
export function blankParts(template: string): string[] {
  return (template ?? '').split(BLANK_MARK)
}
export const blankCount = (template: string): number => Math.max(0, blankParts(template).length - 1)

/** Правые части пар для показа ученику — отсортированы, чтобы порядок не выдавал
 *  правильную привязку (эталон lefts↔rights мы клиенту не отдаём). */
export const matchRights = (pairs: QuizPair[]): string[] => [...new Set(pairs.map((p) => p.right))].sort((a, b) => a.localeCompare(b))

// Ответ ученика (одна форма на все типы): options — choice; text — text/number;
// blanks — blank; match — выбранная правая часть для каждой левой (по порядку lefts).
export interface QuizAnswer {
  options?: string[]
  text?: string
  blanks?: string[]
  match?: string[]
}

/** Убрать правильные ответы из контента перед отдачей авторизованному (сервер
 *  оценивает сам). choice → без correct; text → без accept; number → без answer;
 *  blank → без blanks (шаблон остаётся). */
export function stripQuizAnswers(c: QuizBlockContent): QuizBlockContent {
  switch (quizKind(c)) {
    case 'text': {
      const o = { ...c }
      delete o.accept
      return o
    }
    case 'number': {
      const o = { ...c }
      delete o.answer
      delete o.tolerance
      return o
    }
    case 'blank': {
      const o = { ...c }
      delete o.blanks
      return o
    }
    case 'match': {
      const pairs = c.pairs ?? []
      const o = { ...c, lefts: pairs.map((p) => p.left), rights: matchRights(pairs) }
      delete o.pairs
      return o
    }
    default:
      return { ...c, options: (c.options ?? []).map((o) => ({ id: o.id, text: o.text })) }
  }
}

/** Нормализация текстового ответа: тримминг, схлопывание пробелов, регистр. */
export function normalizeAnswer(s: string, caseSensitive?: boolean): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ')
  return caseSensitive ? t : t.toLowerCase()
}

/** Оценка текстового ответа: совпал ли (после нормализации) с любым принимаемым. */
export function gradeText(input: string, accept: string[], caseSensitive?: boolean): boolean {
  const n = normalizeAnswer(input, caseSensitive)
  return !!n && accept.some((a) => normalizeAnswer(a, caseSensitive) === n)
}

/** Оценка числового ответа: |input − answer| ≤ tolerance. */
export function gradeNumber(input: number, answer: number, tolerance = 0): boolean {
  return Number.isFinite(input) && Math.abs(input - answer) <= Math.abs(tolerance)
}

/** Оценка fill-in-the-blank: каждый пропуск i должен совпасть (после нормализации)
 *  с любым из blanks[i]. Пустой ввод не засчитывается. */
export function gradeBlank(inputs: string[], blanks: string[][], caseSensitive?: boolean): boolean {
  if (!blanks.length) return false
  return blanks.every((acc, i) => {
    const n = normalizeAnswer(inputs[i] ?? '', caseSensitive)
    return !!n && acc.some((a) => normalizeAnswer(a, caseSensitive) === n)
  })
}

/** Оценка сопоставления: для каждой левой i выбранная правая должна совпасть с
 *  эталонной pairs[i].right (по нормализованному тексту). */
export function gradeMatch(assignment: string[], pairs: QuizPair[], caseSensitive?: boolean): boolean {
  if (!pairs.length) return false
  return pairs.every((p, i) => {
    const n = normalizeAnswer(assignment[i] ?? '', caseSensitive)
    return !!n && n === normalizeAnswer(p.right, caseSensitive)
  })
}

/** Разбор video-URL в БЕЗОПАСНУЮ встройку: iframe только для известных
 *  провайдеров (YouTube/Vimeo — не встраиваем произвольный src, это XSS-риск);
 *  прямой файл (.mp4/.webm/.ogg) → <video>; иначе — просто ссылка. */
export function parseVideoEmbed(url: string): { kind: 'youtube' | 'vimeo' | 'file' | 'link'; src: string } {
  const u = (url ?? '').trim()
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (yt) return { kind: 'youtube', src: `https://www.youtube.com/embed/${yt[1]}` }
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vm) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vm[1]}` }
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u)) return { kind: 'file', src: u }
  return { kind: 'link', src: u }
}

export const BLOCK_META: Record<BlockType, { icon: string; en: string; ru: string }> = {
  step: { icon: '👣', en: 'Step', ru: 'Шаг' },
  text: { icon: '📝', en: 'Text', ru: 'Текст' },
  image: { icon: '🖼️', en: 'Image', ru: 'Картинка' },
  poll: { icon: '📊', en: 'Poll', ru: 'Опрос' },
  video: { icon: '🎬', en: 'Video', ru: 'Видео' },
  quiz: { icon: '🎓', en: 'Quiz', ru: 'Тест' },
  file: { icon: '📎', en: 'File', ru: 'Файл' },
}

/** Стабильный id варианта опроса (на него ссылаются голоса). */
export const newOptionId = newBlockId

/** Дедлайн опроса → ms. Дата ('YYYY-MM-DD') трактуется как КОНЕЦ дня; полный
 *  datetime ('...T..') — как есть. null — нет/битый. Общий для рендера/votePoll. */
export function pollDeadlineMs(deadline?: string): number | null {
  if (!deadline) return null
  const t = new Date(deadline.includes('T') ? deadline : `${deadline}T23:59:59`).getTime()
  return Number.isNaN(t) ? null : t
}
