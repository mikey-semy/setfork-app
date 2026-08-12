import type { Lang } from '@/shared/i18n'
import { monthShort } from '@/shared/lib/date'
import { dayKey, parseDayKey, type DayKey } from './types'

// Раскладка календаря вкладов (GitHub-стайл хитмап) — чистый расчёт без разметки:
// какие недели рисуем, где подписи месяцев и насколько густа каждая клетка.

/** Ступени густоты клетки: 0 вкладов → пусто, дальше четыре уровня зелёного. */
export const LEVEL = ['bg-border', 'bg-ok/25', 'bg-ok/50', 'bg-ok/75', 'bg-ok']

/** Границы ступеней: значение попадает в ступень, если не больше её порога. */
export type LevelScale = number[]

/**
 * Пороги густоты — по РАСПРЕДЕЛЕНИЮ дней самого человека, а не по трём числам из
 * кода. У активного участника 40 вкладов в день — обычный вторник, и на жёсткой
 * шкале «7 и больше» вся его сетка заливается максимумом, переставая что-либо
 * показывать; у новичка наоборот. Берём квартили ненулевых дней (так же строит
 * шкалу GitHub), поэтому график читается и на первой неделе, и на десятом году.
 */
export function levelScale(contributions: { count: number }[]): LevelScale {
  const live: number[] = []
  for (const c of contributions) if (c.count > 0) live.push(c.count)
  live.sort((a, b) => a - b)
  if (live.length === 0) return [1, 2, 3]
  const at = (q: number) => live[Math.min(live.length - 1, Math.floor(live.length * q))]
  // Пороги обязаны расти: на бедных данных квартили схлопываются в одно число.
  return [at(0.25), at(0.5), at(0.75)].reduce<number[]>((acc, v) => [...acc, Math.max(v, (acc.at(-1) ?? 0) + 1)], [])
}

export function level(count: number, scale: LevelScale): number {
  if (count === 0) return 0
  const step = scale.findIndex((max) => count <= max)
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
  /** Пороги густоты этого профиля — по его же распределению дней. */
  scale: LevelScale
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

  let lastLabel = -MONTH_LABEL_GAP
  const months = weeks.map((w, i) => {
    // Метку месяца ставим над колонкой, в которую попало 1-е число месяца — тогда
    // ведущий огрызок недели из декабря прошлого года не подписывается «Dec».
    const first = w.find((c) => parseDayKey(c.date)?.getDate() === 1)
    if (!first) return null
    const dt = parseDayKey(first.date)!
    if (year != null && dt.getFullYear() !== year) return null // хвост соседнего года
    if (i - lastLabel < MONTH_LABEL_GAP) return null // не впритык к предыдущей метке
    lastLabel = i
    return monthShort(dt, lang)
  })

  return { weeks, months, total, scale: levelScale(contributions) }
}
