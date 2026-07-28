import { t, type Lang } from '@/shared/i18n'
import type { ModelOption } from '@/shared/ai/models'
import type { Option } from './ModelSelect'

/**
 * ОПЦИИ СЕЛЕКТА МОДЕЛЕЙ — форматирование цен и порядок.
 *
 * Вынесено из страницы админки, потому что тот же список теперь строится ещё и при СМЕНЕ
 * провайдера (серверным экшеном): две копии правил формата гарантированно разъехались бы —
 * у провайдеров разная валюта и разные пороги «дёшево/дорого», и это ровно то место, где
 * расхождение выглядит как «цены врут».
 */
export type Currency = 'USD' | 'RUB'

export function isVariable(m: ModelOption): boolean {
  return m.promptPrice < 0 || m.completionPrice < 0
}
// Цена, по которой красим и сортируем: для эмбеддингов — prompt, для чата — completion (или prompt).
function priceMetric(m: ModelOption, embedding?: boolean): number {
  if (!m.priceKnown) return Number.POSITIVE_INFINITY // цена неизвестна — в конец, серым
  if (isVariable(m)) return Number.POSITIVE_INFINITY // «плавающие» — в конец списка
  return embedding ? m.promptPrice : m.completionPrice || m.promptPrice
}
export const CUR_SIGN: Record<Currency, string> = { USD: '$', RUB: '₽' }
function priceText(m: ModelOption, embedding: boolean, lang: Lang, cur: Currency): string {
  if (!m.priceKnown) return '—' // провайдер не прислал цену: неизвестно ≠ бесплатно
  if (isVariable(m)) return t('priceVariable', lang)
  if (!m.promptPrice && !m.completionPrice) return t('priceFree', lang)
  const s = CUR_SIGN[cur]
  return embedding ? `${s}${m.promptPrice.toFixed(2)}` : `${s}${m.promptPrice.toFixed(2)} / ${s}${m.completionPrice.toFixed(2)}`
}
// Зелёный — дёшево, жёлтый — средне, красный — дорого, серый — плавающая.
// Пороги в валюте каталога (₽-цены Selectel на два порядка «крупнее» долларовых).
function priceClass(metric: number, cur: Currency): string {
  if (!Number.isFinite(metric)) return 'text-muted'
  const [ok, warn] = cur === 'RUB' ? [100, 1000] : [1, 10]
  if (metric <= ok) return 'text-ok'
  if (metric <= warn) return 'text-warn'
  return 'text-danger'
}
export function buildOpts(models: ModelOption[], embedding: boolean, lang: Lang, cur: Currency, pricesKnown: boolean): Option[] {
  if (!pricesKnown) return [...models].map((m) => ({ value: m.id, id: m.id, label: m.label, family: m.family }))
  return [...models]
    .sort((a, b) => priceMetric(a, embedding) - priceMetric(b, embedding))
    .map((m) => ({ value: m.id, id: m.id, label: m.label, family: m.family, price: priceText(m, embedding, lang, cur), priceClass: priceClass(priceMetric(m, embedding), cur) }))
}
