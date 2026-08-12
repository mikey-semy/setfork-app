import type { Lang } from '@/shared/i18n'
import { dayKey, type DayKey } from './types'

// Раскладка календаря вкладов (GitHub-стайл хитмап) — чистый расчёт без разметки:
// какие недели рисуем, где подписи месяцев и насколько густа каждая клетка.

/** Ступени густоты клетки: 0 вкладов → пусто, дальше четыре уровня зелёного. */
export const LEVEL = ['bg-border', 'bg-ok/25', 'bg-ok/50', 'bg-ok/75', 'bg-ok']

/** Порог вкладов за день для каждой ступени (кроме нулевой). */
const LEVEL_UP_TO = [2, 4, 6]

export function level(count: number): number {
  if (count === 0) return 0
  const step = LEVEL_UP_TO.findIndex((max) => count <= max)
  return step === -1 ? LEVEL.length - 1 : step + 1
}

/** Клетка календаря; blank — место без квадратика (будущее или чужой год). */
export interface Cell {
  date: DayKey
  count: number
  blank: boolean
}

export interface Calendar {
  weeks: Cell[][]
  /** Подпись месяца над колонкой недели (null — без подписи). */
  months: (string | null)[]
  total: number
}

/** Недель хватает подписать месяц не чаще, чем раз в столько колонок. */
const MONTH_LABEL_GAP = 3

/** Дней в скользящем окне графа (год без одного дня — как у GitHub). */
const ROLLING_DAYS = 364

/**
 * Сетка календаря: без `year` — скользящее окно ~год до сегодня, с `year` —
 * календарный год (текущий обрезается сегодняшним днём, чтобы правый край сетки
 * был «сейчас», а не пустой хвост будущих месяцев).
 */
export function buildCalendar({
  contributions,
  year,
  lang,
  now = new Date(),
}: {
  contributions: { date: string; count: number }[]
  year?: number
  lang: Lang
  now?: Date
}): Calendar {
  const map = new Map(contributions.map((c) => [c.date, c.count]))
  const total = contributions.reduce((s, c) => s + c.count, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  let gridEnd: Date
  let start: Date
  if (year != null) {
    gridEnd = year === today.getFullYear() ? new Date(today) : new Date(year, 11, 31)
    start = new Date(year, 0, 1)
    start.setDate(start.getDate() - start.getDay())
  } else {
    gridEnd = new Date(today)
    start = new Date(gridEnd)
    start.setDate(start.getDate() - ROLLING_DAYS)
    start.setDate(start.getDate() - start.getDay()) // выравниваем на начало недели (вс)
  }

  const weeks: Cell[][] = []
  const cur = new Date(start)
  while (cur <= gridEnd) {
    const week: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const ds = dayKey(cur)
      // Пустая (без квадратика) клетка: будущее ИЛИ день не из выбранного года.
      const blank = cur > today || (year != null && cur.getFullYear() !== year)
      week.push({ date: ds, count: map.get(ds) ?? 0, blank })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  const fmtMonth = new Intl.DateTimeFormat(lang, { month: 'short' })
  let lastLabel = -MONTH_LABEL_GAP
  const months = weeks.map((w, i) => {
    // Метку месяца ставим над колонкой, в которую попало 1-е число месяца — тогда
    // ведущий огрызок недели из декабря прошлого года не подписывается «Dec».
    const first = w.find((c) => new Date(c.date).getDate() === 1)
    if (!first) return null
    const dt = new Date(first.date)
    if (year != null && dt.getFullYear() !== year) return null // хвост соседнего года
    if (i - lastLabel < MONTH_LABEL_GAP) return null // не впритык к предыдущей метке
    lastLabel = i
    return fmtMonth.format(dt)
  })

  return { weeks, months, total }
}
