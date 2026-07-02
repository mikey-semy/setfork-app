import type { Lang } from '@/shared/i18n'

// Фиксированная палитра меток (как стандартные labels на GitHub).
export const ISSUE_LABELS = [
  { key: 'bug', en: 'bug', ru: 'баг', cls: 'border-danger/40 bg-danger/10 text-danger' },
  { key: 'enhancement', en: 'enhancement', ru: 'улучшение', cls: 'border-accent/40 bg-[var(--accent-soft)] text-accent' },
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
