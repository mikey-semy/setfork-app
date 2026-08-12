import { describe, expect, it } from 'vitest'
import { buildCalendar, level, levelScale } from '@/features/profile/activity/grid'
import { dayKey, parseDayKey } from '@/features/profile/activity/types'

// Клетка календаря — это фильтр ленты, поэтому её ключ (YYYY-MM-DD) ездит между
// сеткой, состоянием страницы и серверным запросом дня: раскладку и разбор ключа
// проверяем отдельно от разметки.

describe('dayKey / parseDayKey', () => {
  it('ходит туда и обратно по местной дате', () => {
    const d = new Date(2026, 7, 12)
    expect(dayKey(d)).toBe('2026-08-12')
    expect(parseDayKey('2026-08-12')?.getTime()).toBe(d.getTime())
  })

  it('не берёт мусор и несуществующие даты', () => {
    expect(parseDayKey('2026-8-12')).toBeNull()
    expect(parseDayKey('вчера')).toBeNull()
    expect(parseDayKey('2026-02-31')).toBeNull() // иначе молча уехало бы на 3 марта
  })
})

describe('levelScale / level', () => {
  it('строит пороги по распределению дней, а не по числам из кода', () => {
    // Активный участник: 40 вкладов в день для него — обычный вторник.
    const busy = [4, 8, 12, 20, 30, 40, 60, 90].map((count) => ({ count }))
    const scale = levelScale(busy)

    expect(scale).toEqual([...scale].sort((a, b) => a - b)) // пороги растут
    expect(level(0, scale)).toBe(0)
    expect(level(4, scale)).toBe(1) // слабый день остаётся слабым
    expect(level(90, scale)).toBe(4)
    // Сетка не заливается максимумом целиком: у ступеней есть населённость.
    expect(new Set(busy.map((c) => level(c.count, scale))).size).toBeGreaterThan(2)
  })

  it('у новичка с единичными днями ступени тоже различимы', () => {
    const scale = levelScale([{ count: 1 }, { count: 1 }, { count: 2 }, { count: 3 }])
    expect(level(1, scale)).toBeLessThan(level(3, scale))
  })

  it('пустая история не ломает шкалу', () => {
    const scale = levelScale([])
    expect(level(0, scale)).toBe(0)
    expect(level(1, scale)).toBe(1)
  })
})

describe('buildCalendar', () => {
  const now = new Date(2026, 7, 12) // среда, 12 августа 2026

  it('скользящее окно кончается сегодняшним днём и не заглядывает вперёд', () => {
    const cal = buildCalendar({ contributions: [{ date: '2026-08-12', count: 3 }], lang: 'ru', now })
    const cells = cal.weeks.flat()
    const live = cells.filter((c) => !c.blank)

    expect(cal.total).toBe(3)
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true)
    expect(live.at(-1)?.date).toBe('2026-08-12')
    expect(cells.filter((c) => c.date > '2026-08-12').every((c) => c.blank)).toBe(true)
    expect(live.find((c) => c.date === '2026-08-12')?.count).toBe(3)
  })

  it('в календарном году гасит клетки соседних лет', () => {
    const cal = buildCalendar({ contributions: [], lang: 'ru', year: 2025, now })
    const live = cal.weeks.flat().filter((c) => !c.blank)

    expect(live.at(0)?.date).toBe('2025-01-01')
    expect(live.at(-1)?.date).toBe('2025-12-31')
    expect(live.every((c) => c.date.startsWith('2025-'))).toBe(true)
  })

  it('текущий год обрезает сегодняшним днём, а не концом декабря', () => {
    const cal = buildCalendar({ contributions: [], lang: 'ru', year: 2026, now })
    const live = cal.weeks.flat().filter((c) => !c.blank)

    expect(live.at(0)?.date).toBe('2026-01-01')
    expect(live.at(-1)?.date).toBe('2026-08-12')
  })

  it('подписывает месяцы по колонке с 1-м числом и не ставит метки впритык', () => {
    const cal = buildCalendar({ contributions: [], lang: 'en', year: 2026, now })
    const labels = cal.months.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)

    expect(cal.months.filter(Boolean)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'])
    expect(labels.every((v, i) => i === 0 || v - labels[i - 1] >= 3)).toBe(true)
  })
})
