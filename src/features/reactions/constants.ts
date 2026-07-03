// Набор реакций как в GitHub (фиксированные 8).
export const REACTION_EMOJI = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'] as const
export type ReactionEmoji = (typeof REACTION_EMOJI)[number]

// Куда можно реагировать (полиморфный target).
export const REACTION_TARGETS = ['issue', 'issue_comment', 'suggestion', 'suggestion_comment'] as const
export type ReactionTarget = (typeof REACTION_TARGETS)[number]

// Агрегат по одному эмодзи на цели.
export type ReactionAgg = { emoji: string; count: number; mine: boolean }
