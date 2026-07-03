import type { Lang } from '@/shared/i18n'

// Относительное время «N дней назад» через Intl.RelativeTimeFormat.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

export function timeAgo(date: Date | string, lang: Lang): string {
  const then = new Date(date).getTime()
  const secs = Math.round((then - Date.now()) / 1000) // отрицательное = в прошлом
  const abs = Math.abs(secs)
  if (abs < 45) return lang === 'ru' ? 'только что' : 'just now'
  const rtf = new Intl.RelativeTimeFormat(lang === 'ru' ? 'ru' : 'en', { numeric: 'auto' })
  for (const [unit, s] of UNITS) {
    if (abs >= s) return rtf.format(Math.round(secs / s), unit)
  }
  return rtf.format(Math.round(secs / 60), 'minute')
}
