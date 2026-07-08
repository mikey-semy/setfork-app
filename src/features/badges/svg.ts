// Генератор SVG-шилдов (flat-стиль, как shields.io) для вставки в README.
// Чистая функция без server-only — тестируется в node напрямую.
//
// Ширина текста считаем эвристикой (нет доступа к метрикам шрифта на сервере):
// ~7px на символ для 11px Verdana-подобного + запас. Достаточно точно для шилдов.

import { escapeHtml as esc } from '@/shared/lib/escape'

const FONT = 11
const PAD = 6 // горизонтальный отступ в каждой половине
const CHAR_W = 6.7 // средняя ширина символа

const textWidth = (s: string) => Math.ceil(s.length * CHAR_W)

/** Плоский шилд «label | value» с настраиваемым цветом правой части. */
export function shield(label: string, value: string, color = '#2159d6'): string {
  const lw = textWidth(label) + PAD * 2
  const vw = textWidth(value) + PAD * 2
  const w = lw + vw
  const h = 20
  // Центры текста в каждой половине (для x); *10 — трюк точности как у shields.io.
  const lx = (lw / 2) * 10
  const vx = (lw + vw / 2) * 10
  const lLen = (textWidth(label) + PAD) * 10
  const vLen = (textWidth(value) + PAD) * 10
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="${h}" fill="#555"/>
<rect x="${lw}" width="${vw}" height="${h}" fill="${esc(color)}"/>
<rect width="${w}" height="${h}" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${FONT * 10}" text-rendering="geometricPrecision">
<text x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${lLen}">${esc(label)}</text>
<text x="${lx}" y="140" transform="scale(.1)" textLength="${lLen}">${esc(label)}</text>
<text x="${vx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${vLen}">${esc(value)}</text>
<text x="${vx}" y="140" transform="scale(.1)" textLength="${vLen}">${esc(value)}</text>
</g>
</svg>`
}

export type BadgeKind = 'stars' | 'forks' | 'runs' | 'version'

/** Компактное представление числа: 1200 → 1.2k. */
export function fmtCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

const KINDS: Record<BadgeKind, { label: string; color: string }> = {
  stars: { label: 'stars', color: '#2159d6' },
  forks: { label: 'forks', color: '#6b6b66' },
  runs: { label: 'runs', color: '#16a34a' },
  version: { label: 'setfork', color: '#1c1c1a' },
}

export function badgeFor(kind: BadgeKind, meta: { starsCount: number; forksCount: number; runsCount: number; version: number }): string {
  const cfg = KINDS[kind]
  const value =
    kind === 'stars' ? fmtCount(meta.starsCount) : kind === 'forks' ? fmtCount(meta.forksCount) : kind === 'runs' ? fmtCount(meta.runsCount) : `v${meta.version}`
  return shield(cfg.label, value, cfg.color)
}

export function isBadgeKind(s: string): s is BadgeKind {
  return s === 'stars' || s === 'forks' || s === 'runs' || s === 'version'
}
