/** Компактное число для счётчиков: 1200 → «1.2k» (как на GitHub). */
export function fmtCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}
