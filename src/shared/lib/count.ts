/** Компактное число для счётчиков: 1200 → «1.2k» (как на GitHub). */
export function fmtCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

// Разделители групп берём у языка (9 186 в русском, 9,186 в английском). Форматтер
// кэшируется: Intl дорог в создании, а числа тут рисуются пачками.
const groupers = new Map<string, Intl.NumberFormat>()

/** Полное число с разделителями: «9 186 вкладов». Для счётчиков-бейджей — fmtCount. */
export function fmtNumber(n: number, lang: string): string {
  let f = groupers.get(lang)
  if (!f) {
    f = new Intl.NumberFormat(lang)
    groupers.set(lang, f)
  }
  return f.format(n)
}
