import type { Lang } from '@/shared/i18n'

// Категории Discussions (app-level пресеты, не enum БД) — как разделы GitHub Discussions.
export const DISCUSSION_CATEGORIES = [
  { key: 'general', en: 'General', ru: 'Общее', icon: '💬' },
  { key: 'ideas', en: 'Ideas', ru: 'Идеи', icon: '💡' },
  { key: 'q-a', en: 'Q&A', ru: 'Вопросы', icon: '❓' },
  { key: 'show', en: 'Show & tell', ru: 'Витрина', icon: '🎉' },
] as const

export type DiscussionCategory = (typeof DISCUSSION_CATEGORIES)[number]['key']
export const isCategory = (k: string): k is DiscussionCategory => DISCUSSION_CATEGORIES.some((c) => c.key === k)
export function categoryMeta(k: string) {
  return DISCUSSION_CATEGORIES.find((c) => c.key === k) ?? DISCUSSION_CATEGORIES[0]
}
export const categoryLabel = (k: string, lang: Lang): string => {
  const m = categoryMeta(k)
  return lang === 'ru' ? m.ru : m.en
}
