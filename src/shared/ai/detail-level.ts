// Объём генерируемого списка. Отдельная ось от ТИПА списка (list-kind.ts): тип решает,
// ЧЕМ является элемент, объём — сколько их и насколько подробно расписан каждый.
export type DetailLevel = 'short' | 'normal' | 'detailed'

export const DETAIL_LEVELS: DetailLevel[] = ['short', 'normal', 'detailed']

export const DEFAULT_DETAIL: DetailLevel = 'normal'

/** Из колонки generations.detail (там свободный текст и NULL у старых строк). */
export function toDetail(value: string | null | undefined): DetailLevel {
  return DETAIL_LEVELS.includes(value as DetailLevel) ? (value as DetailLevel) : DEFAULT_DETAIL
}

/** Подпись для переключателя. en/ru аргументами (i18n-lint не любит тернар-с-литералами). */
export function detailLabel(level: DetailLevel, ru: boolean): string {
  const L: Record<DetailLevel, [en: string, rus: string]> = {
    short: ['Shorter', 'Короче'],
    normal: ['Normal', 'Обычный'],
    detailed: ['Detailed', 'Подробнее'],
  }
  const [en, rus] = L[level]
  return ru ? rus : en
}

/**
 * Строка правила для системного промпта. Для 'normal' — пусто: не давим модель лишними
 * указаниями там, где нас устраивает её обычная развёрстка.
 */
export function detailRule(level: DetailLevel): string {
  if (level === 'short') {
    return '\nLENGTH: keep it tight. Only the steps that are genuinely required, one short sentence each. Prefer ~5-8 items; drop anything optional or obvious.'
  }
  if (level === 'detailed') {
    return '\nLENGTH: be thorough. Break work into granular steps, fill "why" where it is not obvious, cover common pitfalls and edge cases, add refs where a good source exists. Prefer ~12-20 items.'
  }
  return ''
}
