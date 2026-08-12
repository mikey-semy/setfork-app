import type { LocaleText } from '@/shared/i18n'

/**
 * Тема ленты активности — один вид работы за окно (день или месяц) плюс время
 * последнего события в ней: по нему темы и выстраиваются, новые сверху.
 *
 * Тип живёт отдельно от запросов, потому что его читает и клиент (лента и фильтр
 * по дню), а `queries.ts` помечен `server-only`.
 */
export type ActivityTopic =
  /** Опубликованные версии списков: сколько всего и в каких списках (топ). */
  | { kind: 'versions'; at: string; total: number; listsTotal: number; lists: { slug: string; title: LocaleText; count: number }[] }
  /** Созданные списки: сколько всего и какие (топ). */
  | { kind: 'lists'; at: string; total: number; lists: { slug: string; title: LocaleText }[] }
  /** Открытые задачи: сколько и в скольких списках. */
  | { kind: 'issues'; at: string; total: number; listsTotal: number }
  /** Предложенные правки. */
  | { kind: 'suggestions'; at: string; total: number }

export type ActivityKind = ActivityTopic['kind']

/** День окна активности в виде `YYYY-MM-DD` — ключ фильтра по клетке календаря. */
export type DayKey = string

/** `YYYY-MM-DD` по местному времени: ключ клетки календаря и границы дня. */
export function dayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Разбор ключа дня в местную полночь; `null` — если это не `YYYY-MM-DD`. */
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // Отсев несуществующих дат (2026-02-31 → 3 марта): дата обязана совпасть с разбором.
  return dayKey(d) === key ? d : null
}
