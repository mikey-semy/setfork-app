import 'server-only'
import { generateText } from 'ai'
import { getAiSettings } from '@/shared/settings/ai'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { spotlight } from './spotlight'
import { extractUsage, outcomeOf, recordUsage } from './usage'
import { langEnName, type Lang } from '@/shared/i18n'

/**
 * «Копать глубже» (HQ §8): один СЛОЙ раскопки под шагом списка. Слой = один
 * дешёвый вызов строго по клику — глубина оплачивается только по желанию.
 *
 * Крепильщик встроен в промпт (MVP): слой N+1 опирается ТОЛЬКО на шаг и
 * предыдущие слои, без прыжков; нет уверенности — модель обязана сказать
 * прямо, а не сочинить. Летописец — провенанс пишет вызывающий (actions).
 */

export const DIG_MAX_LEVEL = 3

/** Подписи слоёв — лестница, не хаос: у каждого уровня своя задача. */
export function digLevelBrief(level: number): string {
  if (level === 1)
    return 'LEVEL 1 — REASONS & SOURCES: why this step is done this way; what it is based on (standards, physics, common practice). Name the kind of source (spec, cookbook rule, safety standard) even if you cannot give a URL.'
  if (level === 2)
    return 'LEVEL 2 — MECHANISM & EXCEPTIONS: how it actually works under the hood, and WHEN THIS ADVICE BREAKS (edge cases, wrong conditions, common failure modes).'
  return 'LEVEL 3 — FINE POINTS: subtleties experts argue about, trade-offs, adjacent techniques worth knowing.'
}

export interface DigStepInput {
  listTitle: string
  stepTitle: string
  stepDesc: string
  stepWhy: string
  command: string
}

export async function generateDigLayer(
  step: DigStepInput,
  prevLayers: string[],
  level: number,
  lang: Lang,
  meta: { userId: string; templateId: string },
  sources: string[] = [],
): Promise<{ content: string; model: string; provider: string } | null> {
  const client = await getAiChatClient()
  if (!client) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  const model = await pickChatModel(settings)
  const sp = spotlight()

  const system = `You are a mining gnome in the SetFork workshop, digging BELOW one step of a how-to list — layer by layer, like a mine shaft.
${digLevelBrief(level)}
SHORING RULES (the mine must not collapse):
- Build ONLY on the step itself and the previous layers given. No leaps: do not introduce claims unrelated to this step.
- If you are not confident about a fact, say so plainly ("точных данных нет" / "no reliable data") instead of inventing.
- Be concrete and compact: 3-6 short paragraphs or bullets, no intro/outro filler.
- Answer in ${langEnName(lang)}.
${sp.rule()}`

  const prevBlock = prevLayers.length ? `\n\nPREVIOUS LAYERS (dig below them, do not repeat):\n${sp.wrap('LAYERS', prevLayers.map((p, i) => `— layer ${i + 1} —\n${p}`).join('\n'))}` : ''
  // Гранулярный индекс кормит слои источниками (HQ §8): чужой публичный текст → spotlight.
  const srcBlock = sources.length ? `\n\nFrom the SetFork knowledge base (real precedents — cite what you use, don't copy blindly):\n${sp.wrap('SOURCES', sources.join('\n'))}` : ''
  const prompt = `${sp.wrap(
    'STEP',
    `List: ${step.listTitle}\nStep: ${step.stepTitle}${step.stepDesc ? `\n${step.stepDesc}` : ''}${step.stepWhy ? `\nWhy (author): ${step.stepWhy}` : ''}${step.command ? `\nCommand: ${step.command}` : ''}`,
  )}${prevBlock}${srcBlock}\n\nDig layer ${level}.`

  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: 600,
      abortSignal: AbortSignal.timeout(60_000),
    })
    const usage = extractUsage(result)
    await recordUsage({ userId: meta.userId, feature: 'dig', model, input: usage.input, output: usage.output, total: usage.total, cost: usage.cost, refType: 'template', refId: meta.templateId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const content = result.text.trim()
    return content ? { content, model, provider: client.cfg.provider } : null
  } catch (e) {
    await recordUsage({ userId: meta.userId, feature: 'dig', model, input: 0, output: 0, total: 0, cost: 0, refType: 'template', refId: meta.templateId, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return null
  }
}
