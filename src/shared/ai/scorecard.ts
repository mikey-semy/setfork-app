/**
 * СКОРКАРТ СПЕЦИАЛИСТА — чистые правила «на что можно опираться, а на что нельзя».
 *
 * Существующая репутация (gnome-reputation) отвечает на один вопрос: как часто принимали
 * генерацию, в которой он участвовал. Для кадровых решений этого мало по двум причинам, и обе
 * взяты не из головы:
 *
 *   1. ОДНА ОСЬ ОБМАНЫВАЕТ. «Agents that Matter» (arXiv 2605.27621) предупреждает: вклад в
 *      разные цели расходится, и оценка по единственному сигналу приёмки говорит скорее о
 *      популярности темы, чем о работе. Поэтому здесь ДВЕ оси — приёмка и многогранность
 *      (уникальные грани, доехавшие до финала) — и код ОТКАЗЫВАЕТСЯ ранжировать, пока обе не
 *      наполнены данными.
 *   2. ДОВЕРИЕ НЕ ПЕРЕНОСИТСЯ В ДОМЕН. Skill-conditional оценка (arXiv 2606.14200): «хорош
 *      вообще» ≠ «хорош в этом ремесле». Отсюда zero-evidence gate: в домене без ПРЯМЫХ
 *      попыток скоркарта нет вовсе — не ноль, не средний по гному, а «нет оснований».
 *
 * Это shadow-режим: правила считают и объясняют, но НИКОГО не наймут и не уволят. Действия —
 * следующий шаг, и только после калибровки порогов на живых данных.
 */

/** Меньше — цифре нельзя верить: на двух попытках «50%» вводит в заблуждение. */
export const MIN_ATTEMPTS = 5

/** Оси скоркарта. Обе обязательны для ранжирования — см. §1 выше. */
export interface Axes {
  /** Приёмка: Σ 1/N по принятым генерациям (кредит с сохранением) и число попыток. */
  attempts: number
  acceptedShare: number
  /** Многогранность: уникальные грани и сколько из них дожило до финала (метрика facets). */
  uniqueFacets: number
  deliveredFacets: number
  /** Витков с сохранёнными черновиками — знаменатель второй оси. */
  facetRuns: number
}

export type Verdict = 'no-evidence' | 'one-axis-only' | 'thin' | 'rankable'

export interface Scorecard {
  verdict: Verdict
  /** Причина вердикта человеческим языком — для админки и для журнала. */
  why: string
  /** Доля принятого (0..1) либо null, если оснований нет. */
  acceptance: number | null
  /** Доля уникальных граней, доехавших до финала (0..1), либо null. */
  facetDelivery: number | null
}

/** Названия осей для объяснения вердикта (диагностика для владельца, как в журнале). */
const MISSING_AXIS = { acceptance: 'приёмке', facets: 'многогранности' } as const

const rate = (part: number, total: number): number | null => (total > 0 ? part / total : null)

/**
 * Вердикт по осям. Порядок проверок — это и есть политика:
 *   нет попыток → нет оснований; есть только одна ось → ранжировать нельзя;
 *   мало данных → «тонко» (показываем, но решений не принимаем); иначе → можно ранжировать.
 */
export function scorecardOf(a: Axes): Scorecard {
  const acceptance = rate(a.acceptedShare, a.attempts)
  const facetDelivery = rate(a.deliveredFacets, a.uniqueFacets)

  if (a.attempts === 0 && a.facetRuns === 0) {
    return { verdict: 'no-evidence', why: 'прямых попыток в этом домене не было', acceptance: null, facetDelivery: null }
  }
  if (a.attempts === 0 || a.facetRuns === 0) {
    // Формулируем без тернарника с двумя литералами: линтер видит в такой конструкции
    // двуязычную строку (и по делу — эвристика бережёт словарь), а нам нужен выбор слова.
    const missing = MISSING_AXIS[a.attempts === 0 ? 'acceptance' : 'facets']
    return {
      verdict: 'one-axis-only',
      why: `данных по ${missing} нет — по одной оси не ранжируем`,
      acceptance,
      facetDelivery,
    }
  }
  if (a.attempts < MIN_ATTEMPTS) {
    return { verdict: 'thin', why: `попыток ${a.attempts} — меньше ${MIN_ATTEMPTS}, цифре верить рано`, acceptance, facetDelivery }
  }
  return { verdict: 'rankable', why: `две оси наполнены (${a.attempts} попыток)`, acceptance, facetDelivery }
}

/**
 * Можно ли принимать по этому скоркарту КАДРОВОЕ решение. Отдельная функция, а не «score >
 * X»: решение должно упираться в явную проверку, которую видно в коде и которую нельзя
 * случайно обойти сравнением чисел.
 */
export function decidable(s: Scorecard): boolean {
  return s.verdict === 'rankable'
}

/** Сортировка для показа: сначала те, по кому есть основания; внутри — по приёмке. */
export function byStrength(a: Scorecard, b: Scorecard): number {
  const order: Record<Verdict, number> = { rankable: 0, thin: 1, 'one-axis-only': 2, 'no-evidence': 3 }
  if (order[a.verdict] !== order[b.verdict]) return order[a.verdict] - order[b.verdict]
  return (b.acceptance ?? -1) - (a.acceptance ?? -1)
}
