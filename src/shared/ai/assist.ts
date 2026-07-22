import 'server-only'
import { generateText } from 'ai'
import { getAiSettings } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { langEnName, type Lang } from '@/shared/i18n'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { extractUsage, outcomeOf, recordUsage } from './usage'
import { spotlight } from './spotlight'

// «Помощь на шаге»: короткая AI-подсказка человеку, застрявшему на шаге прогона.
// Отличие от generate*: работает с ОДНИМ шагом, возвращает текст (markdown),
// а не список; должна быть быстрой (застрявший ждёт), поэтому короткий вывод
// и жёсткий таймаут. Наш data moat в промпте — агрегат опыта других прогонов
// (только ЦИФРЫ; чужие тексты причин не показываем — приватность note).

const ASSIST_TIMEOUT_MS = 45_000
const MAX_FIELD_CHARS = 1_500

export interface AssistStepContext {
  listTitle: string
  stepTitle: string
  stepDesc: string
  stepWhy: string
  stepCommand: string
  subtasks: string[]
  /** Индексы уже сделанных подшагов — чтобы совет не повторял пройденное. */
  subtasksDone: number[]
  /** Причина «не получилось» из runStepState.note (может быть пустой). */
  reason: string
  prevTitle: string
  nextTitle: string
  /** Опыт других прогонов этого шага (только счётчики, без чужих текстов). */
  stats?: { passed: number; stuck: number }
}

/** Чистая сборка промпта (юнит-тестируется без клиента). */
export function buildAssistPrompt(ctx: AssistStepContext, lang: Lang): { system: string; prompt: string } {
  const langName = langEnName(lang)
  const sp = spotlight()
  const clip = (s: string) => s.slice(0, MAX_FIELD_CHARS)
  const system = `You help a person who is STUCK on one step of a checklist they are following.
Respond in ${langName}. Be concrete and brief: 3-6 short bullet points (markdown).
Structure: 1) most likely cause & fix for their situation, 2) a quick check to confirm, 3) an alternative route if the direct way is closed.
If the step itself looks outdated or impossible, say so and suggest reporting it to the list author.
Never invent commands for non-technical steps; never include URLs you are not sure exist.
${sp.rule()}`

  const done = new Set(ctx.subtasksDone)
  const subtaskLines = ctx.subtasks.length
    ? ctx.subtasks.map((s, i) => `${done.has(i) ? '[x]' : '[ ]'} ${s}`).join('\n')
    : ''
  const stats = ctx.stats
  // Счётчики — доверенные (посчитаны сервером), идут ВНЕ spotlight-обёрток.
  const statsLine =
    stats && stats.passed + stats.stuck > 0
      ? `Community context (trusted, computed server-side): ${stats.passed} runner(s) completed this step, ${stats.stuck} got stuck on it.`
      : ''

  const parts = [
    sp.wrap('LIST TITLE', clip(ctx.listTitle)),
    sp.wrap('STEP', clip(ctx.stepTitle)),
    ctx.stepDesc && sp.wrap('STEP DETAILS', clip(ctx.stepDesc)),
    ctx.stepWhy && sp.wrap('WHY THIS STEP MATTERS', clip(ctx.stepWhy)),
    ctx.stepCommand && sp.wrap('STEP COMMAND', clip(ctx.stepCommand)),
    subtaskLines && sp.wrap('SUBTASKS ([x] = already done)', clip(subtaskLines)),
    ctx.prevTitle && sp.wrap('PREVIOUS STEP (already reached)', clip(ctx.prevTitle)),
    ctx.nextTitle && sp.wrap('NEXT STEP (their goal after this one)', clip(ctx.nextTitle)),
    ctx.reason && sp.wrap('WHAT THE PERSON SAYS WENT WRONG', clip(ctx.reason)),
    statsLine,
    `The person is stuck on the step above. Help them get unstuck.`,
  ].filter(Boolean)

  return { system, prompt: parts.join('\n\n') }
}

/** Подсказка по шагу. null — фича недоступна/бюджет/ошибка (caller показывает мягкую ошибку). */
export async function assistOnStep(
  ctx: AssistStepContext,
  lang: Lang,
  opts: { userId: string; refId?: string },
): Promise<string | null> {
  const client = await getAiChatClient()
  if (!client) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null

  const model = await pickChatModel(settings)
  const { system, prompt } = buildAssistPrompt(ctx, lang)
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: 0.4,
      maxOutputTokens: 600, // короткая помощь, не эссе — и потолок цены вызова
      abortSignal: AbortSignal.timeout(ASSIST_TIMEOUT_MS),
    })
    const text = result.text.trim()
    const u = extractUsage(result)
    await recordUsage({
      userId: opts.userId,
      feature: 'assist',
      model,
      input: u.input,
      output: u.output,
      total: u.total,
      cost: u.cost,
      refType: 'assist',
      refId: opts.refId,
      outcome: text ? 'ok' : 'invalid',
      durationMs: Date.now() - startedAt,
      provider: client.cfg.provider,
    })
    return text || null
  } catch (e) {
    await recordUsage({
      userId: opts.userId,
      feature: 'assist',
      model,
      input: 0,
      output: 0,
      total: 0,
      cost: 0,
      refType: 'assist',
      refId: opts.refId,
      outcome: outcomeOf(e),
      durationMs: Date.now() - startedAt,
      provider: client.cfg.provider,
    })
    return null
  }
}
