// Quiz-домен: контент quiz-блока, стрип ответов, оценка всех видов тестов.
// ЧИСТЫЙ модуль (правило core: без импортов) — используется рендером списка,
// server-оценкой (quizzes), MCP и редактором.
//
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
export type QuizKind = 'choice' | 'text' | 'number' | 'blank' | 'match' | 'sort' | 'code'
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
  // sort — расставить в правильном порядке. items = эталонный порядок; после стрипа
  // для клиента шлём shuffled (перемешанные), items прячем. code — как text (accept),
  // но моноширинный ввод; caseSensitive по умолчанию учитывается автором.
  items?: string[]
  shuffled?: string[]
}

export const quizKind = (c: QuizBlockContent): QuizKind => c.kind ?? 'choice'

/** Детерминированное «перемешивание» для показа sort-элементов (без Math.random,
 *  чтобы SSR был стабилен): сортировка по длине+тексту — порядок не совпадает с эталоном
 *  в большинстве случаев, но стабилен и не выдаёт правильную последовательность как есть. */
export const shuffleSort = (items: string[]): string[] => [...items].sort((a, b) => a.length - b.length || a.localeCompare(b))

/** Оценка сортировки: последовательность ответа совпадает с эталонным порядком. */
export function gradeSort(order: string[], items: string[], caseSensitive?: boolean): boolean {
  if (!items.length || order.length !== items.length) return false
  return items.every((it, i) => normalizeAnswer(order[i] ?? '', caseSensitive) === normalizeAnswer(it, caseSensitive))
}

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
  order?: string[] // sort — расставленная учеником последовательность
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
    case 'sort': {
      const o = { ...c, shuffled: shuffleSort(c.items ?? []) }
      delete o.items
      return o
    }
    case 'code': {
      const o = { ...c }
      delete o.accept
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
