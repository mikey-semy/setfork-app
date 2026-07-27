/**
 * КЛАСС ПОЛНОТЫ СПИСКА — градуированная оценка вместо «годно / не годно».
 *
 * Взято у Википедии (классы Stub → Start → C → B → GA → FA и модель `articlequality` в ORES),
 * но сознательно упрощено и переименовано. Два отличия, оба принципиальные:
 *
 *   1. Это ПОЛНОТА СТРУКТУРЫ, а не качество и не правда. Машина не может утверждать, что
 *      список верный — у неё нет доступа к физическому миру (потому и существует пометка
 *      «здесь нужен человек»). Она может посчитать, есть ли у шагов описания, ссылки, «зачем».
 *   2. Считается ПРАВИЛАМИ, а не обученной моделью. У Википедии есть размеченный сообществом
 *      корпус — у нас нет; ML-оценка без него была бы дороже и менее честной, чем прямые
 *      признаки. Плюс правила объяснимы: класс всегда приходит с причиной.
 *
 * Зачем градация: планка владельца становится осмысленной («публикуй от класса N») вместо
 * «минимум N шагов», а у петли появляется ЦЕЛЬ — `next` говорит, чего конкретно не хватает
 * до следующего класса. Улучшать «вообще» нельзя, улучшать «добавить ссылки» можно.
 */

export const GRADES = ['stub', 'start', 'solid', 'full'] as const
export type ListGrade = (typeof GRADES)[number]

/** Порядок классов для сравнения с планкой. */
export const gradeRank = (g: ListGrade): number => GRADES.indexOf(g)

export interface GradeFeatures {
  steps: number
  /** Сколько шагов имеют непустое описание. */
  withDesc: number
  /** Сколько шагов объясняют «зачем». */
  withWhy: number
  /** Число уникальных ссылок на источники. */
  refs: number
  /** Подтверждённо мёртвые ссылки (404/410) — не «неизвестно». */
  deadLinks: number
  /** Есть ли разбиение на секции (для длинных списков это структура, а не украшение). */
  sections: boolean
  /** Сколько шагов честно помечены «здесь нужен человек». */
  needsHuman: number
}

export interface GradeVerdict {
  grade: ListGrade
  /** Почему именно этот класс — по одной причине на признак, который не дотянул. */
  reasons: string[]
  /** Что поднимет класс. Это ЗАДАНИЕ для петли, а не украшение отчёта. */
  next: string[]
}

const share = (part: number, total: number) => (total > 0 ? part / total : 0)

/**
 * Требования класса. Проверяются снизу вверх: класс = самый высокий, все требования которого
 * выполнены. Числа выбраны так, чтобы «solid» соответствовал списку, который человек реально
 * может выполнить и проверить (описания у большинства шагов + хотя бы один источник), а «full»
 * — списку, который не стыдно показывать как образец.
 */
const RULES: { grade: ListGrade; check: (f: GradeFeatures) => string[] }[] = [
  {
    grade: 'start',
    check: (f) => {
      const out: string[] = []
      if (f.steps < 4) out.push(`шагов ${f.steps} — для «start» нужно 4`)
      if (share(f.withDesc, f.steps) < 0.5) out.push('меньше половины шагов с описанием')
      return out
    },
  },
  {
    grade: 'solid',
    check: (f) => {
      const out: string[] = []
      if (f.steps < 6) out.push(`шагов ${f.steps} — для «solid» нужно 6`)
      if (share(f.withDesc, f.steps) < 0.7) out.push('описания меньше чем у 70% шагов')
      if (f.refs < 1) out.push('ни одного источника')
      if (f.deadLinks > 0) out.push(`мёртвых ссылок: ${f.deadLinks}`)
      return out
    },
  },
  {
    grade: 'full',
    check: (f) => {
      const out: string[] = []
      if (f.steps < 8) out.push(`шагов ${f.steps} — для «full» нужно 8`)
      if (share(f.withDesc, f.steps) < 0.85) out.push('описания меньше чем у 85% шагов')
      if (share(f.withWhy, f.steps) < 0.5) out.push('«зачем» меньше чем у половины шагов')
      if (f.refs < 2) out.push('источников меньше двух')
      if (f.deadLinks > 0) out.push(`мёртвых ссылок: ${f.deadLinks}`)
      // Длинный список без секций читается сплошняком; короткому секции не нужны.
      if (f.steps >= 10 && !f.sections) out.push('длинный список без секций')
      return out
    },
  },
]

/**
 * Класс списка по структурным признакам.
 *
 * Пометки «здесь нужен человек» класс НЕ понижают — наоборот, это признак честности: список,
 * который сам показывает, где нужен опыт, полезнее того, который выдумал цифру. Поэтому они
 * не входят в требования, но попадают в причины как отдельная заметка.
 */
export function gradeList(f: GradeFeatures): GradeVerdict {
  let grade: ListGrade = 'stub'
  let firstFail: string[] = []
  for (const rule of RULES) {
    const fails = rule.check(f)
    if (fails.length) {
      firstFail = fails
      break
    }
    grade = rule.grade
  }
  const reasons: string[] = []
  if (grade === 'stub' && !firstFail.length) reasons.push('пустой список')
  if (f.needsHuman > 0) reasons.push(`честных пометок «нужен человек»: ${f.needsHuman}`)
  return { grade, reasons, next: firstFail }
}

/** Признаки из пунктов списка — одна функция на все вызывающие, чтобы правила не разъезжались. */
export function featuresOf(
  items: { desc?: string; why?: string; section?: string; refs?: { url?: string }[]; needsHuman?: boolean }[],
  deadLinks = 0,
): GradeFeatures {
  const urls = new Set<string>()
  let withDesc = 0
  let withWhy = 0
  let needsHuman = 0
  let sections = false
  for (const it of items) {
    if ((it.desc ?? '').trim()) withDesc++
    if ((it.why ?? '').trim()) withWhy++
    if ((it.section ?? '').trim()) sections = true
    if (it.needsHuman) needsHuman++
    for (const r of it.refs ?? []) if (r.url?.trim()) urls.add(r.url.trim())
  }
  return { steps: items.length, withDesc, withWhy, refs: urls.size, deadLinks, sections, needsHuman }
}
