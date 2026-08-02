import { withPrDefaults } from './pr-settings'

/** Роль пушащего: ядро исполняет по ней правило пространства имён (Ф5). */
export type PushRole = 'owner' | 'collaborator' | 'contributor'

/** То, что нужно для ответа «открыт ли список» — и ничего сверх. */
export type ContributionGate = {
  visibility: string
  status: string
  moderation: string
  prSettings: unknown
}

/**
 * Ф5: открыт ли список для правок ПОСТОРОННИХ — тот же вопрос, на который
 * отвечает веб-форма предложений.
 *
 * Отдельным модулем, а не строчкой в роуте, по той же причине, по которой
 * отдельно живёт политика повторов зеркала: правило нужно и роуту, и тесту, а
 * тест, повторяющий правило своей копией, проверяет копию. Разъехавшись, они
 * дали бы худший из возможных исходов — «предлагайте» в браузере и «нельзя» в
 * терминале на один и тот же список.
 *
 * Условия намеренно совпадают с веб-путём: список публичный, опубликованный,
 * прошедший модерацию, и владелец не сузил круг предлагающих.
 */
export function openForContributions(meta: ContributionGate): boolean {
  return (
    meta.visibility === 'public' &&
    meta.status === 'published' &&
    meta.moderation === 'active' &&
    withPrDefaults(meta.prSettings).allowFrom === 'all'
  )
}
