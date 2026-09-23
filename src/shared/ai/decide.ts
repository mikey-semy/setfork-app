import 'server-only'
import { getOpenRouterApiKey, openRouterBaseUrl } from '@/shared/settings/ai'
import { openRouterBody } from './provider'
import { outcomeOf, recordUsage, type AiOutcome } from './usage'

/**
 * РЕШЕНИЕ, А НЕ ТЕКСТ: клиент Decisions API (TypeSafe Jev через OpenRouter).
 *
 * Jev отвечает на вопросы с заранее заданными ответами — какой из вариантов (`choice`),
 * да или нет (`noul`), на каком уровне шкалы (`score`) — за доли секунды и доли цента, и
 * к каждому ответу прикладывает уверенность. Писать текст он не умеет вовсе. Поэтому он НЕ
 * встаёт в поле `model` гнома и не подменяет чат-модель: это инструмент рядом с ними, для
 * решений, которые сейчас принимает совпадение строк (кто ведёт по пункту, какого типа
 * список). Встраивать ли — решает замер `scripts/gnome-routing-eval.ts`, а не этот файл.
 *
 * ⚠️ Сбой — это `null`, а не исключение. Вызывающий ОБЯЗАН иметь запасное правило: решение,
 * которое роняет запрос, хуже нынешнего совпадения строк.
 */

/**
 * Модель — прибита к версии. Алиас `~typesafe/jev-latest` однажды уедет на новую версию,
 * и замеры перестанут повторяться; брать его — только осознанно, переменной.
 */
const DEFAULT_MODEL = 'typesafe/jev-1.13'

/**
 * Потолок ожидания. Jev отвечает за 0,1–2,2 с (замер 23.09.2026, включая холодный первый
 * вызов); ждать дольше десятка секунд значит держать вызывающего ради решения, которое
 * он и так умеет принять запасным правилом.
 */
const TIMEOUT_MS = 10_000

export async function decideModel(): Promise<string> {
  return process.env.SETFORK_DECIDE_MODEL?.trim() || DEFAULT_MODEL
}

export type DecideQuestion =
  /** Один вариант из набора: ключ — ответ, значение — его описание для модели. */
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  /** Да или нет: ответ — вероятность «да». */
  | { type: 'noul'; instructions: string }
  /** Уровень шкалы: `criteria` — описания уровней по возрастанию, ответ — дробный уровень. */
  | { type: 'score'; instructions: string; criteria: string[] }

export type DecideAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number; confidence?: number }
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }

export interface DecideResult<K extends string> {
  answers: Record<K, DecideAnswer>
  /** Модель, которая ответила на самом деле (с датой сборки), — не та, что просили. */
  model: string
  usage: { inputTokens: number; outputTokens: number; cost: number }
  durationMs: number
}

/**
 * Путь к Decisions API из корня OpenRouter.
 *
 * Корень у нас — `…/api/v1` (`openRouterBaseUrl`), а Decisions живёт НЕ под `/v1`:
 * `…/api/alpha/decisions`. Проверено живым вызовом 23.09.2026 — `…/api/v1/alpha/decisions`
 * и `…/api/v1/decisions` отвечают 404. Корень берётся из общих настроек, а не зашивается:
 * в проде он может смотреть на egress-мост.
 */
export function decisionsUrl(base: string): string {
  return `${base.replace(/\/+$/, '').replace(/\/v1$/, '')}/alpha/decisions`
}

/** Тело запроса — вместе с политикой данных (`openRouterBody`), как у любого вызова OpenRouter. */
export function decideBody(model: string, state: string, questions: Record<string, DecideQuestion>): Record<string, unknown> {
  return openRouterBody({ model, state, questions })
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNumMap = (v: unknown): v is Record<string, number> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(isNum)
const isStrMap = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === 'string')

/** Ответ на один вопрос — или `null`, если форма не та, что обещает тип. */
export function parseAnswer(q: DecideQuestion, raw: unknown): DecideAnswer | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (q.type === 'choice') {
    if (typeof a.choice !== 'string' || !Object.hasOwn(q.criteria, a.choice)) return null
    if (!isNum(a.confidence) || !isNumMap(a.probabilities)) return null
    return { type: 'choice', choice: a.choice, probabilities: a.probabilities, confidence: a.confidence }
  }
  if (q.type === 'noul') {
    if (!isNum(a.noul)) return null
    return { type: 'noul', noul: a.noul, ...(isNum(a.confidence) ? { confidence: a.confidence } : {}) }
  }
  // Легенда — часть обещанного типа: без неё (или массивом, или не строками) ответ не той
  // формы, и выдавать его за `ok` нельзя (находка авто-ревью к #961).
  if (!isNum(a.score) || !isNum(a.confidence) || !isNumMap(a.probabilities) || !isStrMap(a.legend)) return null
  return { type: 'score', score: a.score, legend: a.legend, probabilities: a.probabilities, confidence: a.confidence }
}

/**
 * Задать модели вопросы о состоянии. Каждый вызов — в `ai_usage` (фича `decide`) с
 * настоящей стоимостью из `usage.cost` ответа: Аналитик моделей видит Jev в том же журнале,
 * что и остальные модели, и цена докладывается вместе с качеством.
 */
export async function decide<K extends string>(input: {
  state: string
  questions: Record<K, DecideQuestion>
  /** Переопределить модель — для замера и проверки сбоя; по умолчанию `decideModel()`. */
  model?: string
  refType?: string
  /** uuid: колонка `ai_usage.ref_id` другого не примет, и строка журнала пропала бы молча. */
  refId?: string
  userId?: string | null
}): Promise<DecideResult<K> | null> {
  const model = input.model ?? (await decideModel())
  const t0 = Date.now()
  let outcome: AiOutcome = 'error'
  let answeredModel = model
  let usage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  try {
    const key = await getOpenRouterApiKey()
    if (!key) return null
    const res = await fetch(decisionsUrl(openRouterBaseUrl()), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'SetFork' },
      body: JSON.stringify(decideBody(model, input.state, input.questions)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    // Тело читается ДО проверки статуса намеренно: у отказа OpenRouter в теле и причина
    // (`error.message` — «Model … does not exist», «No endpoints found»), и `usage` —
    // её надо записать в журнал, а не потерять. Ошибку за успех это не выдаёт: `!res.ok`
    // проверяется сразу ниже, до разбора ответов; тело не JSON — `null`.
    const json = (await res.json().catch(() => null)) as {
      model?: unknown
      answers?: Record<string, unknown>
      usage?: { input_tokens?: unknown; output_tokens?: unknown; cost?: unknown }
      error?: { message?: unknown }
    } | null
    if (json?.usage) {
      usage = {
        inputTokens: isNum(json.usage.input_tokens) ? json.usage.input_tokens : 0,
        outputTokens: isNum(json.usage.output_tokens) ? json.usage.output_tokens : 0,
        cost: isNum(json.usage.cost) ? json.usage.cost : 0,
      }
    }
    if (typeof json?.model === 'string') answeredModel = json.model
    if (!res.ok || !json) {
      console.warn(`[decide] HTTP ${res.status}: ${String(json?.error?.message ?? '').slice(0, 200)}`)
      return null
    }
    const answers = {} as Record<K, DecideAnswer>
    for (const k of Object.keys(input.questions) as K[]) {
      const a = parseAnswer(input.questions[k], json.answers?.[k])
      if (!a) {
        outcome = 'invalid'
        console.warn(`[decide] ответ на «${k}» не разобран`)
        return null
      }
      answers[k] = a
    }
    outcome = 'ok'
    return { answers, model: answeredModel, usage, durationMs: Date.now() - t0 }
  } catch (e) {
    outcome = outcomeOf(e)
    console.warn('[decide] вызов не удался', e instanceof Error ? e.message : e)
    return null
  } finally {
    await recordUsage({
      userId: input.userId ?? null,
      feature: 'decide',
      model: answeredModel,
      input: usage.inputTokens,
      output: usage.outputTokens,
      total: usage.inputTokens + usage.outputTokens,
      cost: usage.cost,
      refType: input.refType,
      refId: input.refId,
      outcome,
      durationMs: Date.now() - t0,
      provider: 'openrouter',
    })
  }
}
