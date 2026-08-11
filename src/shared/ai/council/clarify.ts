import 'server-only'
import type { Lang } from '@/shared/i18n'
import { firstJson, type CouncilRunner } from './call'

/** Ответы пользователя дописываются в запрос этой меткой — второй раз спрашивать нельзя. */
const ALREADY_CLARIFIED = /\[User clarifications\]/i

const MAX_QUESTIONS = 3

/**
 * Ворота беседы: спросить ли у человека 2-3 уточнения, прежде чем собирать совет.
 *
 * Отдельный фокусный вызов, а не поле в ответе распорядителя (HQ §clarify): fast-модель
 * Яндекса, делая четыре задачи разом (глубина+тип+состав+вопросы), почти всегда роняла
 * именно вопросы — «Деплой на VPS» уходил в совет без беседы. Отдельная задача с
 * примерами в обе стороны исполняется надёжно.
 *
 * Пустой массив = спрашивать не о чем (или уже спрашивали) — виток идёт дальше.
 */
export async function askClarify(ctx: {
  run: CouncilRunner
  /** Быстрая модель: решение дешёвое и не должно занимать модель финального качества. */
  fast: string
  /** Запрос как есть — по нему видно, отвечал ли человек на прошлые вопросы. */
  query: string
  /** Тема в обёртке spotlight (текст пользователя недоверенный). */
  topic: string
  lang: Lang
  langName: string
  spotlightRule: string
  enabled: boolean
  /** Номер попытки: спрашиваем только на первой, иначе зациклимся. */
  attempt: number
}): Promise<string[]> {
  const { run, fast, query, topic, lang, langName, spotlightRule, enabled, attempt } = ctx
  if (!enabled || attempt !== 1 || ALREADY_CLARIFIED.test(query)) return []

  const gate = await run(
    fast,
    `You decide whether a list-generating council must ASK the user 2-3 questions FIRST, or can proceed right away.
ASK when the request is underspecified — a bare fragment/pronoun ("organize it", "help me"), or a broad activity/goal whose good list depends on unstated parameters: stack/OS, skill level, budget, goal, scope, audience, constraints.
  Examples that MUST ask: "Deploy to a VPS" (which stack? OS? zero-downtime?), "Deploy an app on a VPS", "Learn guitar" (genre? level?), "Plan a trip" (where? days? budget?), "Start a business", "Get fit", "Организовать переезд".
PROCEED (no questions) when the request already names a concrete, self-contained subject: a specific dish ("домашний зефир"), a specific book/topic list ("книги про гномов"), a specific well-scoped how-to ("настроить бэкапы Postgres на VPS в S3").
When asking: write 2-3 SHORT questions. ALL questions and options MUST be written in ${langName} — this is not a preference, it is the language of the person who asked. Where natural, append 2-4 quick answer OPTIONS after a "|": "Which stack? | Node.js | Python | PHP | Docker". Starting with questions is GOOD service, not friction.
Return ONLY JSON: {"ask": true|false, "questions": ["...only if ask"]}
${spotlightRule}`,
    `REQUEST:\n${topic}`,
    220,
  )
  if (!gate) return []

  try {
    const g = JSON.parse(firstJson(gate.text)) as { ask?: boolean; questions?: string[] }
    if (g.ask !== true) return []
    // flatMap, а не filter().map(): один проход, пустые и не-строки отсеиваются сразу.
    const questions = Array.isArray(g.questions)
      ? g.questions.flatMap((q) => (typeof q === 'string' && q.trim() ? [q.trim()] : [])).slice(0, MAX_QUESTIONS)
      : []
    return questions.length && !wrongLanguage(questions, lang) ? questions : []
  } catch {
    // не распарсили — идём как обычно, без беседы
    return []
  }
}

/**
 * ПРОВЕРКА ЯЗЫКА КОДОМ. Просьба «пиши на языке запроса» адресована быстрой модели — той
 * самой, про которую известно, что она роняет именно эту задачу. Опросник на чужом языке
 * хуже, чем его отсутствие: он выглядит поломкой, а не заботой.
 *
 * Правило слабее, чем «определённый язык совпал», и это НАМЕРЕННО: у русского
 * технического опросника («Стек? | Node.js | Python | Docker») латиница по долям символов
 * побеждает, и строгая проверка отрезала бы беседу ровно там, где она нужнее всего — у
 * недоопределённых технических запросов (находка ревью). Поэтому судим по ПРИСУТСТВИЮ
 * письменности: для русского хватает кириллицы где угодно в опроснике.
 */
function wrongLanguage(questions: string[], lang: Lang): boolean {
  const hasCyrillic = /[а-яА-Я]/.test(questions.join(' '))
  return lang === 'ru' ? !hasCyrillic : hasCyrillic
}
