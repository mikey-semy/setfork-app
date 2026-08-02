import { t, type Lang } from '@/shared/i18n'
import type { ModelOption } from '@/shared/ai/models'
import type { Option, OptionMeta } from './ModelSelect'

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
/**
 * Границы «дёшево / средне / дорого» — ТЕРЦИЛИ САМОГО КАТАЛОГА, а не числа в коде.
 *
 * Пороги-константы ($1/$10, ₽100/₽1000) держались на двух допущениях: что валют ровно две и
 * что цены на рынке стоят на месте. Оба неверны: у каждого провайдера свой порядок цен, и он
 * меняется быстрее, чем правки в этом файле. Терциль отвечает на вопрос, который на самом деле
 * задаёт владелец: «дорогая ОТНОСИТЕЛЬНО ЧЕГО?» — относительно того, что предлагает провайдер.
 *
 * Меньше трёх известных цен — красить нечем: возвращаем бесконечности, всё будет нейтральным.
 */
export function priceTiers(metrics: number[]): [number, number] {
  const xs = metrics.filter((m) => Number.isFinite(m)).sort((a, b) => a - b)
  if (xs.length < 3) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1)))]
  return [at(1 / 3), at(2 / 3)]
}

// Зелёный — дешёвая треть каталога, жёлтый — середина, красный — дорогая треть,
// серый — цена неизвестна или плавающая.
function priceClass(metric: number, [ok, warn]: [number, number]): string {
  if (!Number.isFinite(metric)) return 'text-muted'
  if (metric <= ok) return 'text-ok'
  if (metric <= warn) return 'text-warn'
  return 'text-danger'
}
/**
 * Сохранённая модель ВСЕГДА присутствует опцией — даже если каталог пуст или её в нём нет.
 *
 * Одна реализация на оба пути (серверный рендер страницы и серверный экшен смены провайдера):
 * раньше это были две копии, экшен свою потерял — и после переключения провайдера селект
 * оставался без единой опции, а поле подменялось голым вводом. Выглядело как «выбор моделей
 * с ценами откатили», хотя откатывать было нечего.
 */
export function withSavedOption(opts: Option[], current: string): Option[] {
  // missing — та самая мина: модель сохранена, но провайдер её больше не обслуживает.
  // Раньше она вставлялась в список как обычная опция и выглядела рабочей; на деле это 404
  // на каждой генерации. Теперь её видно и в списке, и на странице моделей.
  return current && !opts.some((o) => o.value === current) ? [{ value: current, id: current, missing: true }, ...opts] : opts
}

/** Окно контекста человеку: 128000 → «128k». 0 = провайдер не сказал, ничего не показываем. */
export function contextText(tokens: number): string {
  if (!tokens) return ''
  return tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}k`
}

/**
 * Опции селекта. `meta` — наш опыт и занятость (model-enrich): группа списка, рейтинг, кто уже
 * сидит на модели. Без неё всё уезжает в группу «не пробовали» — так и есть, если журнал пуст.
 *
 * Порядок ВНУТРИ группы — цена по возрастанию; группы раскладывает сам ModelSelect, поэтому
 * здесь по-прежнему один плоский отсортированный список.
 */
export function buildOpts(
  models: ModelOption[],
  embedding: boolean,
  lang: Lang,
  cur: Currency,
  pricesKnown: boolean,
  meta?: ReadonlyMap<string, OptionMeta>,
): Option[] {
  const tech = (m: ModelOption) => ({ context: contextText(m.contextLength), structured: m.structured, intelligence: m.intelligence })
  if (!pricesKnown)
    return [...models].map((m) => ({ value: m.id, id: m.id, label: m.label, family: m.family, ...tech(m), meta: meta?.get(m.id) }))
  // Пороги цвета считаем по ЭТОМУ каталогу, а не по числам из кода: у чата и эмбеддингов,
  // у OpenRouter и Selectel порядки цен разные, и общей шкалы для них не существует.
  const tiers = priceTiers(models.map((m) => priceMetric(m, embedding)))
  return [...models]
    .sort((a, b) => priceMetric(a, embedding) - priceMetric(b, embedding))
    .map((m) => ({
      value: m.id,
      id: m.id,
      label: m.label,
      family: m.family,
      price: priceText(m, embedding, lang, cur),
      priceClass: priceClass(priceMetric(m, embedding), tiers),
      ...tech(m),
      meta: meta?.get(m.id),
    }))
}
