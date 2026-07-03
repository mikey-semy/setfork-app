// Куда можно реагировать (полиморфный target).
export const REACTION_TARGETS = ['issue', 'issue_comment', 'suggestion', 'suggestion_comment'] as const
export type ReactionTarget = (typeof REACTION_TARGETS)[number]

// Агрегат по одному эмодзи на цели.
export type ReactionAgg = { emoji: string; count: number; mine: boolean }

// Верхняя граница длины строки-эмодзи (сложные ZWJ-последовательности + защита от мусора).
export const MAX_EMOJI_LEN = 32
