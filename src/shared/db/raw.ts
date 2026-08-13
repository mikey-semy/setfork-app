import 'server-only'

/**
 * Значение даты из СЫРОГО SQL-выражения — к настоящей дате.
 *
 * `sql<Date | null>\`max(...)\`` — это обещание разработчика, а не гарантия: drizzle
 * такие выражения не отображает, отдаёт то, что вернул драйвер, и компилятор
 * промах не увидит. Достаточно агрегата, приведения типа или новой версии
 * драйвера — и вместо Date приходит строка, а первый же `.getTime()` роняет
 * задачу с «getTime is not a function» (так 13.08 умерла петля самогенерации,
 * причём БЕЗ адреса: стек тогда не сохранялся).
 *
 * Поэтому у любой даты, пришедшей из сырого выражения, один вход — сюда.
 */
export function asDate(v: unknown): Date | null {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}
