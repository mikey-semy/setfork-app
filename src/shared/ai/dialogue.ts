import 'server-only'
import { getAiSettings } from '@/shared/settings/ai'
import { getRoster, gnomeSpeak, type Expert } from './gnomes'
import { pushMessage } from './generation-messages'
import { type Lang } from '@/shared/i18n'

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
  const settings = await getAiSettings().catch(() => null)
  if (!settings?.enabled) return
  // Дневной кап — и здесь (фикс по ревью): это был единственный LLM-вызов в обход предохранителя.
  const { globalBudgetOk } = await import('@/shared/quota')
  if (!(await globalBudgetOk().catch(() => false))) return
  const roster = await getRoster().catch(() => [])
  const gnome = pickAddressee(note, roster, listKind)
  if (!gnome) return

  // Единый ДОМ ГНОМОВ (gnomeSpeak, short): реплика гнома в генерации — тот же
  // характер/настроение/аккуратность, что везде. Смена языка — часть short-задачи.
  const reply = await gnomeSpeak(gnome, note, {
    lang,
    short: true,
    feature: 'refine',
    refType: 'generation',
    refId: generationId,
    userId,
    maxTokens: 140,
  }).catch(() => null)
  if (!reply?.text) return
  await pushMessage(generationId, {
    attempt,
    kind: 'reply',
    text: reply.text,
    who: gnome.id,
    name: lang === 'ru' ? gnome.nameRu : gnome.nameEn,
  }).catch(() => {})
}
