/**
 * ГОТОВНОСТЬ К ПУБЛИКАЦИИ (гейт P8) — чистая логика: кворум линз и правило допуска.
 *
 * Зачем: компания производит черновики, а публиковать их некому — владелец не может
 * читать каждый список, и петля упирается в человека на каждом пункте. Ответ доков:
 * человек утверждает ПЛАНКУ, а не каждую публикацию.
 *
 * Что гейт спрашивает — важнее, чем как он считает. Он НЕ судья правильности: машина
 * не имеет доступа к физическому миру и не может подтвердить, что рецепт вкусный или
 * что процедура сработает на живом сервере. Гейт спрашивает одно: **годен ли список
 * как основа для улучшения человеком** — можно ли по нему действовать, не выдуман ли он,
 * и есть ли там что улучшать. Реальную пользу принесёт человек, у него доступ к опыту.
 *
 * Три правила устройства, каждое против конкретного способа обмануться:
 *   1. Кворум считает КОД, а не модель. Модель отвечает по одной узкой линзе; сложение
 *      вердиктов ей не доверяется — иначе «в целом хорошо» перевешивает провал линзы.
 *   2. Fail-closed. Нет полного набора ответов (модель упала, таймаут, мусор в ответе) →
 *      черновик остаётся черновиком. Отсутствие ответа НИКОГДА не читается как «годно».
 *   3. 'unsure' считается провалом. Сомнение линзы — причина оставить список человеку,
 *      а не разрешить публикацию.
 *
 * Отдельно от модерации (features/moderation): та решает «безопасно ли показывать», эта —
 * «готово ли к показу». Опубликованный гейтом список идёт через модерацию как любой другой.
 */

/** Линзы гейта. Каждая — узкий функциональный вопрос, а не «оцени качество». */
export const READINESS_LENSES = ['actionable', 'grounded', 'improvable'] as const
export type ReadinessLens = (typeof READINESS_LENSES)[number]

export type LensAnswer = 'pass' | 'fail' | 'unsure'

export interface LensVerdict {
  lens: ReadinessLens
  answer: LensAnswer
  /** Короткое обоснование от линзы — попадает в журнал и в админку. */
  reason: string
}

/** Планка владельца. Дефолты — самые строгие: гейт включается решением, а не сам. */
export interface ReadinessBar {
  /** 'off' — не работает; 'shadow' — считает и пишет, но не публикует; 'on' — публикует. */
  mode: 'off' | 'shadow' | 'on'
  /** Какие линзы обязаны пройти. Пустой набор = гейт не может пропустить ничего. */
  required: readonly ReadinessLens[]
  /** Минимум шагов в списке (структурная проверка кодом, без модели). */
  minSteps: number
  /** Разрешать публикацию при мёртвых ссылках. По умолчанию нет. */
  allowDeadLinks: boolean
}

export const DEFAULT_BAR: ReadinessBar = {
  mode: 'off',
  required: READINESS_LENSES,
  minSteps: 5,
  allowDeadLinks: false,
}

/** Структурные факты о списке — считаются кодом, стоят ноль и не врут. */
export interface ReadinessFacts {
  steps: number
  deadLinks: number
  hasDesc: boolean
  hasTags: boolean
  /** Сколько шагов с повторяющимся заголовком (набивка объёма). */
  duplicateSteps: number
}

export interface ReadinessDecision {
  /** Публиковать ли. В 'shadow' и 'off' всегда false — решение только считается. */
  publish: boolean
  /** Прошёл бы гейт, будь режим 'on' (для теневого наблюдения перед включением). */
  wouldPass: boolean
  /** Почему НЕ прошёл — по строке на причину, в порядке проверки. */
  blockers: string[]
  /** Ответы линз как есть (для журнала). */
  verdicts: LensVerdict[]
}

/** Структурные блокеры (кодом, без модели). Дешёвое отсекается до трат на линзы. */
export function structuralBlockers(facts: ReadinessFacts, bar: ReadinessBar): string[] {
  const out: string[] = []
  if (facts.steps < bar.minSteps) out.push(`шагов ${facts.steps} < планки ${bar.minSteps}`)
  if (!bar.allowDeadLinks && facts.deadLinks > 0) out.push(`мёртвых ссылок: ${facts.deadLinks}`)
  if (!facts.hasDesc) out.push('нет описания')
  if (!facts.hasTags) out.push('нет тегов')
  if (facts.duplicateSteps > 0) out.push(`повторяющихся шагов: ${facts.duplicateSteps}`)
  return out
}

/** Сколько шагов имеют неуникальный заголовок (нормализация как в отпечатке контента). */
export function countDuplicateSteps(titles: string[]): number {
  const seen = new Map<string, number>()
  for (const t of titles) {
    const k = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    if (!k) continue
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0)
}

/** Решение гейта. Единственное место, где складываются вердикты — и складывает их КОД. */
export function readinessDecision(facts: ReadinessFacts, verdicts: LensVerdict[], bar: ReadinessBar): ReadinessDecision {
  const blockers = structuralBlockers(facts, bar)

  // Планка без обязательных линз пропустить не может: иначе «включил гейт и забыл
  // настроить линзы» означало бы автопубликацию по одним структурным признакам.
  if (!bar.required.length) blockers.push('планка не настроена: нет обязательных линз')

  const byLens = new Map(verdicts.map((v) => [v.lens, v]))
  for (const lens of bar.required) {
    const v = byLens.get(lens)
    // Fail-closed: нет ответа — блокер, а не «пропустим».
    if (!v) blockers.push(`линза ${lens}: ответа нет`)
    else if (v.answer !== 'pass') blockers.push(`линза ${lens}: ${v.answer}${v.reason ? ` — ${v.reason}` : ''}`)
  }

  const wouldPass = blockers.length === 0
  return { publish: wouldPass && bar.mode === 'on', wouldPass, blockers, verdicts }
}
