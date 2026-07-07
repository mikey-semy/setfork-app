import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { pickChatModel } from './credits'
import { extractUsage, recordUsage } from './usage'

export interface ModerationVerdict {
  flagged: boolean
  category: string // S-код + название по таксономии MLCommons, или '' если безопасно
  reason: string
  confidence: number // 0..1 — уверенность классификатора в вердикте
}

// Промт на базе стандартной таксономии опасностей MLCommons (как в Llama Guard, S1–S14).
const SYSTEM = `You are a safety classifier for a PUBLIC how-to checklist website (mostly developer/IT, but any topic).
Decide whether a list is safe to show publicly. Classify against the MLCommons hazard taxonomy.

Flag (unsafe) ONLY if the list provides actionable how-to content that materially enables real-world harm in one of:
S1 Violent Crimes — assisting violence against people/animals.
S2 Non-Violent Crimes — fraud, scams, malware/hacking meant to cause harm, theft, drug production/trafficking.
S3 Sex-Related Crimes — trafficking, sexual assault, non-consensual acts.
S4 Child Sexual Exploitation — any sexual content involving minors.
S6 Specialized Advice — dangerous medical/financial/legal instructions presented as safe/authoritative.
S9 Indiscriminate Weapons — explosives, incendiaries, chemical/biological/nuclear/radiological weapons.
S10 Hate — demeaning/dehumanizing a protected group; inciting hatred.
S11 Suicide & Self-Harm — encouraging or instructing self-harm, suicide, eating disorders.
S12 Sexual Content — explicit sexual/pornographic material.

SAFE (do NOT flag): ordinary technical/DevOps/coding, defensive security & hardening, penetration testing in the abstract,
education, cooking, fitness, productivity, everyday legal tasks, general knowledge.
Bias toward SAFE for ambiguous, defensive, or educational content — this is a checklist site, not a weapons manual.

Return ONLY strict JSON, no markdown:
{"flagged": boolean, "category": string, "reason": string, "confidence": number}
category = the matching "Sx Name" (e.g. "S9 Indiscriminate Weapons") or "" when safe. reason = one short sentence.
confidence = 0..1, how certain you are in this verdict. Use < 0.7 when the content is ambiguous,
borderline, satire/fiction, or you lack context — such cases go to a human reviewer.`

/** ИИ-классификатор безопасности (MLCommons-таксономия). null — если ИИ недоступен/ошибка. */
export async function moderateContent(
  text: string,
  meta: { userId?: string; refId?: string } = {},
): Promise<ModerationVerdict | null> {
  const apiKey = await getApiKey()
  if (!apiKey || !text.trim()) return null
  const settings = await getAiSettings()
  const openrouter = createOpenRouter({
    apiKey,
    appName: 'SetFork',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  })
  const model = await pickChatModel(settings)
  let result: Awaited<ReturnType<typeof generateText>>
  try {
    result = await generateText({
      model: openrouter.chat(model, { usage: { include: true } }),
      system: SYSTEM,
      prompt: `Classify this list:\n${text.slice(0, 4000)}`,
      temperature: 0,
      maxOutputTokens: 200,
    })
  } catch {
    // ИИ недоступен (сеть/5xx) — транзиентная ошибка, вызывающий вправе ретраить.
    return null
  }
  const u = extractUsage(result)
  await recordUsage({ userId: meta.userId, feature: 'moderate', model, ...u, refType: 'template', refId: meta.refId })
  try {
    const cleaned = result.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const obj = JSON.parse(cleaned) as { flagged?: unknown; category?: unknown; reason?: unknown; confidence?: unknown }
    const conf = Number(obj.confidence)
    return {
      flagged: !!obj.flagged,
      category: String(obj.category ?? '').slice(0, 60),
      reason: String(obj.reason ?? '').slice(0, 300),
      // модель не вернула число → считаем уверенным (поведение старого бинарного вердикта)
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.9,
    }
  } catch {
    // Модель ответила, но не JSON: это НЕ транзиентная ошибка — при temperature=0 повторный
    // вызов даст тот же мусор, а деньги спишутся снова. Поэтому не ретраим (не бросаем null,
    // на который вызывающий делает retry), а отдаём неуверенный вердикт: на гейте он уйдёт
    // к человеку (hold), живой список при пере-проверке не тронем.
    return { flagged: false, category: '', reason: 'classifier returned unparseable output', confidence: 0 }
  }
}
