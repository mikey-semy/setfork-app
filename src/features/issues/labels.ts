import type { Lang } from '@/shared/i18n'
import { isHexColor } from '@/shared/lib/color'
export { isHexColor }

// Фиксированная палитра меток (как стандартные labels на GitHub).
export const ISSUE_LABELS = [
  { key: 'bug', en: 'bug', ru: 'баг', cls: 'border-danger/40 bg-danger/10 text-danger' },
  { key: 'enhancement', en: 'enhancement', ru: 'улучшение', cls: 'border-accent/40 bg-(--accent-soft) text-accent' },
  { key: 'question', en: 'question', ru: 'вопрос', cls: 'border-warn/40 bg-warn/10 text-warn' },
  { key: 'docs', en: 'docs', ru: 'документация', cls: 'border-ok/40 bg-ok/10 text-ok' },
  { key: 'help', en: 'help wanted', ru: 'нужна помощь', cls: 'border-ok/40 bg-ok/10 text-ok' },
  { key: 'wontfix', en: 'wontfix', ru: 'не будет', cls: 'border-border bg-surface-2 text-muted' },
] as const

export type IssueLabelKey = (typeof ISSUE_LABELS)[number]['key']

const BY_KEY = new Map(ISSUE_LABELS.map((l) => [l.key, l]))

export function isLabelKey(k: string): k is IssueLabelKey {
  return BY_KEY.has(k as IssueLabelKey)
}

export function labelMeta(key: string) {
  return BY_KEY.get(key as IssueLabelKey) ?? null
}

export function labelText(key: string, lang: Lang): string {
  const m = labelMeta(key)
  return m ? (lang === 'ru' ? m.ru : m.en) : key
}

// ── Кастомные метки списка (сверх встроенной палитры) ────────────────
// На issue хранятся ключом `c:<id>`, чтобы не путать со встроенными ключами.
export interface CustomLabel {
  id: string
  name: string
  color: string // hex #rrggbb
}
const CUSTOM_PREFIX = 'c:'
export const customKey = (id: string): string => CUSTOM_PREFIX + id
export const isCustomKey = (k: string): boolean => k.startsWith(CUSTOM_PREFIX)
export const customId = (k: string): string => k.slice(CUSTOM_PREFIX.length)


export interface ChipColors {
  backgroundColor: string
  color: string
  borderColor: string
}
/** Филл-пилюля из произвольного hex с читаемым текстом (по яркости фона). */
export function chipColors(hex: string): ChipColors {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return { backgroundColor: hex, color: lum > 0.6 ? '#1c1c1a' : '#ffffff', borderColor: hex }
}

/** Единый резолв метки для рендера: встроенная (cls) или кастомная (style). */
export interface ResolvedChip {
  text: string
  cls?: string
  style?: ChipColors
}
export function resolveChip(key: string, custom: CustomLabel[], lang: Lang): ResolvedChip {
  if (isCustomKey(key)) {
    const c = custom.find((x) => x.id === customId(key))
    return c ? { text: c.name, style: chipColors(c.color) } : { text: key } // осиротевшая метка — как есть
  }
  const m = labelMeta(key)
  return m ? { text: lang === 'ru' ? m.ru : m.en, cls: m.cls } : { text: key }
}
