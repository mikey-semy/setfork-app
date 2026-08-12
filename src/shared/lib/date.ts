import type { Lang } from '@/shared/i18n'

/**
 * Даты одним видом на весь сайт. `Intl.DateTimeFormat` дорог в создании и дёшев в
 * повторном использовании, поэтому форматтеры кэшируются по языку и набору полей —
 * раньше каждый список строил новый на КАЖДУЮ строку.
 */
const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}:${JSON.stringify(opts)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, opts)
    cache.set(key, f)
  }
  return f
}

/** «авг. 2026» — месяц и год (регистрация, вехи). */
export function monthYear(value: Date | string | number, lang: Lang): string {
  return formatter(lang, { year: 'numeric', month: 'short' }).format(new Date(value))
}

/** «11 авг. 2026» — полная дата без времени (прохождение курса, события). */
export function dayMonthYear(value: Date | string | number, lang: Lang): string {
  return formatter(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

/** «11 августа 2026» — дата заголовком (день, на который сужена лента активности). */
export function fullDate(value: Date | string | number, lang: Lang): string {
  return formatter(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
}

/** «август 2026» — месяц заголовком (окно ленты активности). */
export function monthYearLong(value: Date | string | number, lang: Lang): string {
  return formatter(lang, { month: 'long', year: 'numeric' }).format(new Date(value))
}

/** «авг.» — короткий месяц (подписи над колонками календаря вкладов). */
export function monthShort(value: Date | string | number, lang: Lang): string {
  return formatter(lang, { month: 'short' }).format(new Date(value))
}

/** «пн» — короткий день недели (колонка слева от календаря вкладов). */
export function weekdayShort(value: Date | string | number, lang: Lang): string {
  return formatter(lang, { weekday: 'short' }).format(new Date(value))
}
