import type { LocaleText } from '@/shared/i18n'

/**
 * Тема ленты активности — один вид работы за окно (день или месяц) плюс время
 * последнего события в ней: по нему темы и выстраиваются, новые сверху.
 *
 * Тип живёт отдельно от запросов, потому что его читает и клиент (лента и фильтр
 * по дню), а `queries.ts` помечен `server-only`.
 */
export type ActivityTopic =
  /** Опубликованные версии списков: сколько всего и в скольких списках. */
  | { kind: 'versions'; at: string; total: number; listsTotal: number }
  /** Созданные списки. */
  | { kind: 'lists'; at: string; total: number }
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

/** Строка второго уровня: список, в котором шла работа по теме. */
export interface TopicList {
  /** ID списка: slug уникален только внутри владельца, адресоваться по нему нельзя. */
  id: string
  /** Ник ВЛАДЕЛЬЦА списка: задачу и правку человек мог оставить в чужом. */
  ownerHandle: string
  slug: string
  title: LocaleText
  count: number
  /** ISO последнего события в этом списке — по нему строки и сортируются. */
  at: string
}

/** Строка третьего уровня: само событие внутри списка. */
export interface ListEvent {
  /** Номер версии, задачи или предложения — то, чем событие адресуется. */
  ref: number
  /** Пояснение (note версии, заголовок задачи); у предложений его нет. */
  text: string
  at: string
}

/** Что раскрывают: перечень списков темы или события внутри одного списка. */
export interface DetailsRequest {
  kind: ActivityKind
  /** Окно ленты: день `YYYY-MM-DD` или месяц `YYYY-MM`. */
  windowKey: string
  /** Задан — нужны события ЭТОГО списка (третий уровень). */
  listId?: string
}

/** Ответ подгрузки: сколько всего и что показываем (перечень обрезан лимитом). */
export interface DetailsPage<T> {
  items: T[]
  total: number
}
