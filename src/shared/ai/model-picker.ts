import { envNumber } from '@/shared/env'
import type { ModelOption } from './models'

/**
 * ВЫБОР МОДЕЛЕЙ ИЗ ЖИВОГО КАТАЛОГА — вместо списков id в коде.
 *
 * Списки-константы (`DEFAULT_COUNCIL_MODELS`, `defaultChatModelFor → 'openai/gpt-4o-mini'`)
 * ломаются ровно одним способом: провайдер снимает модель с обслуживания, и вызов начинает
 * отвечать 404 при полностью исправном ключе. Так сюда и приехала снятая
 * `anthropic/claude-3.5-haiku` — генерация молча возвращала пустоту (аудит 2026-08-01).
 *
 * Правило здесь одно: спросить каталог. Функции чистые — их можно проверить тестом, не
 * поднимая сеть, а вызывающий отвечает за то, откуда каталог взялся.
 */

/** Цена, по которой сравниваем: выход дороже входа и определяет счёт. Неизвестна или
 *  плавающая (провайдер отдаёт отрицательную) → бесконечность: такие в хвост. */
export function priceOf(m: ModelOption): number {
  if (!m.priceKnown) return Number.POSITIVE_INFINITY
  const out = m.completionPrice || m.promptPrice
  return out < 0 || m.promptPrice < 0 ? Number.POSITIVE_INFINITY : out
}

/** Есть ли в каталоге вообще сведения о признаке (их публикует не каждый провайдер).
 *  Нет — значит по этому признаку выбирать нельзя, а не «никто не годится». */
const anyStructured = (models: ModelOption[]) => models.some((m) => m.structured)
const anyRated = (models: ModelOption[]) => models.some((m) => m.intelligence > 0)

/**
 * ПЛАНКА КАЧЕСТВА — перцентиль опубликованных оценок каталога, а не список «хороших» моделей.
 *
 * Без неё «дешёвая» и «годная» неразличимы: живая проверка на каталоге из 336 моделей выдала
 * в пул ролеплейные файнтюны на 8B — формально самые дешёвые у своих вендоров. Оценку даёт сам
 * каталог (artificial_analysis intelligence index), планку берём от РАСПРЕДЕЛЕНИЯ этих оценок,
 * поэтому она не устаревает вместе с рынком.
 *
 * Где именно её ставить — перцентиль. Дефолт выбран ЗАМЕРОМ на живом каталоге (336 моделей,
 * 2026-08-01): на медиане в пул пролезала посредственность с оценкой 37 при ~50 у лидеров,
 * на 0.65 остаются рабочие лошадки. Настраивается стендом, смысл неизменен — «верхняя треть
 * того, что каталог вообще оценил».
 */
export const QUALITY_PCTL = envNumber('SETFORK_COUNCIL_QUALITY_PCTL', 0.65)

/**
 * Минимальное окно контекста для рабочей лошадки, токенов. Наш промпт ограничен сверху
 * MAX_PROMPT_CHARS=12000 символов (≈3-4 тыс. токенов) плюс ответ до ai.max_tokens (потолок
 * 8000) — отсюда порядок. Аналог `enable_pre_call_checks` у LiteLLM: модель, в которую запрос
 * не влезает, отсеивается ДО вызова, а не роняет его.
 */
export const MIN_CONTEXT = envNumber('SETFORK_MIN_CONTEXT_TOKENS', 16_000)

export function qualityFloor(models: ModelOption[], pctl: number): number {
  const xs = models.map((m) => m.intelligence).filter((x) => x > 0).sort((a, b) => a - b)
  if (!xs.length) return 0
  return xs[Math.min(xs.length - 1, Math.floor(pctl * (xs.length - 1)))]
}

/**
 * Кандидаты на роль рабочей лошадки: с известной ценой, не бесплатные, умеющие строгий JSON
 * и не ниже планки качества — каждый признак применяется, ТОЛЬКО если провайдер его публикует.
 *
 * Бесплатные отсеиваются не из брезгливости: у free-вариантов жёсткие лимиты частоты
 * (у OpenRouter — десятки запросов в сутки), а один совет это 6–7 вызовов подряд. Признак
 * берём из данных — нулевая цена, — а не из суффикса в имени.
 */
export function workhorses(models: ModelOption[], pctl = QUALITY_PCTL, minContext = MIN_CONTEXT): ModelOption[] {
  const wantStructured = anyStructured(models)
  const floor = anyRated(models) ? qualityFloor(models, pctl) : 0
  return models
    .filter(
      (m) =>
        Number.isFinite(priceOf(m)) &&
        priceOf(m) > 0 &&
        (!wantStructured || m.structured) &&
        (!floor || m.intelligence >= floor) &&
        // Окно контекста: модель, в которую наш промпт физически не влезает, не «дешёвая»,
        // а неработающая. 0 = провайдер окна не назвал, тогда не отсеиваем (см. правило выше).
        (!m.contextLength || m.contextLength >= minContext),
    )
    .sort((a, b) => priceOf(a) - priceOf(b))
}

/**
 * Пул совета из каталога: САМАЯ ДЕШЁВАЯ модель каждого вендора, дальше по цене вверх.
 *
 * Разные вендоры — это не украшение: совет и заводился ради несогласия, а два клона одной
 * модели дают одно мнение дважды. Первой идёт самая дешёвая — она же ведёт промежуточные
 * шаги (распорядитель, критик), и её скорость определяет длительность всего совета.
 *
 * Каталог пуст или ничего не подошло → пустой список: вызывающий откатится на уже
 * проверенную основную модель, а не на выдуманный id.
 */
export function deriveCouncilPool(models: ModelOption[], size: number, pctl = QUALITY_PCTL): string[] {
  const best = new Map<string, ModelOption>()
  for (const m of workhorses(models, pctl)) {
    const family = m.family || m.id
    if (!best.has(family)) best.set(family, m) // список уже по цене — первый и есть дешёвый
  }
  return [...best.values()]
    .sort((a, b) => priceOf(a) - priceOf(b))
    .slice(0, Math.max(1, size))
    .map((m) => m.id)
}

/**
 * Живая модель вместо назначенной: если `wanted` в каталоге есть — берём её, вопросов нет.
 * Нет — каталог знает, чем заменить (самая дешёвая рабочая лошадка).
 *
 * Каталог пуст (нет ключа, сеть, гео-блок) — возвращаем `wanted` как есть: отсутствие
 * сведений не повод подменять осознанный выбор владельца.
 */
export function liveModel(models: ModelOption[], wanted: string): string {
  if (!models.length) return wanted
  if (models.some((m) => m.id === wanted)) return wanted
  return workhorses(models)[0]?.id ?? models[0]?.id ?? wanted
}
