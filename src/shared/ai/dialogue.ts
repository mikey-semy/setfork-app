import 'server-only'
import { generateText } from 'ai'
import { getAiSettings } from '@/shared/settings/ai'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { spotlight } from './spotlight'
import { extractUsage, outcomeOf, recordUsage } from './usage'
import { getRoster, type Expert } from './roster'
import { pushMessage } from './generation-messages'
import { langEnName, type Lang } from '@/shared/i18n'

/**
 * Диалог с гномами (HQ §2, этап 3): реплика человека в чате — СОБЫТИЕ, на
 * которое коротко отвечает адресованный гном («принял, вот что сделаю»),
 * прежде чем совет уйдёт в новый виток. Один flash-вызов, fire-and-forget:
 * сбой ответа никогда не мешает самому витку.
 */

/** Тип списка → профильный гном (когда никто не назван по имени). */
const KIND_TO_GNOME: Record<string, string> = {
  recipe: 'chef',
  inventory: 'hoarder',
  procedure: 'generalist',
  checklist: 'generalist',
  criteria: 'scholar',
  options: 'scholar',
}

/** Адресат: названный по имени (ru/en, без регистра) сильнее профильного по типу. */
export function pickAddressee(note: string, roster: Expert[], listKind: string | null): Expert | null {
  const low = note.toLowerCase()
  const named = roster.find((e) => (e.nameRu && low.includes(e.nameRu.toLowerCase())) || (e.nameEn && low.includes(e.nameEn.toLowerCase())))
  if (named) return named
  const byKind = roster.find((e) => e.id === KIND_TO_GNOME[listKind ?? ''])
  return byKind ?? roster.find((e) => e.id === 'generalist') ?? roster[0] ?? null
}

/** Короткий ответ гнома на реплику + запись в ленту витка. Ошибки глотаются сознательно. */
export async function replyToUser(
  generationId: string,
  attempt: number,
  note: string,
  listKind: string | null,
  lang: Lang,
  userId: string,
): Promise<void> {
  const client = await getAiChatClient().catch(() => null)
  const settings = await getAiSettings().catch(() => null)
  if (!client || !settings?.enabled) return
  // Дневной кап — и здесь (фикс по ревью): это был единственный LLM-вызов в обход предохранителя.
  const { globalBudgetOk } = await import('@/shared/quota')
  if (!(await globalBudgetOk().catch(() => false))) return
  const roster = await getRoster().catch(() => [])
  const gnome = pickAddressee(note, roster, listKind)
  if (!gnome) return
  const model = await pickChatModel(settings).catch(() => '')
  if (!model) return
  const sp = spotlight()
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system: `You are ${gnome.persona}
The user just added a remark to the gnome-council chat while their list is being refined. Reply with ONE short in-character line (max 100 characters, no quotes): acknowledge the remark and say concretely what you will do with it. Language: ${langEnName(lang)}.
${sp.rule()}`,
      prompt: sp.wrap('REMARK', note),
      temperature: settings.temperature,
      maxOutputTokens: 120,
      abortSignal: AbortSignal.timeout(20_000),
    })
    const u = extractUsage(result)
    await recordUsage({ userId, feature: 'refine', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'generation', refId: generationId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const text = result.text.trim().replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 160)
    if (!text) return
    await pushMessage(generationId, {
      attempt,
      kind: 'reply',
      text,
      who: gnome.id,
      name: lang === 'ru' ? gnome.nameRu : gnome.nameEn,
    }).catch(() => {})
  } catch (e) {
    await recordUsage({ userId, feature: 'refine', model, input: 0, output: 0, total: 0, cost: 0, refType: 'generation', refId: generationId, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider }).catch(() => {})
  }
}
