import { pickPrecedentsDetailed } from '@/shared/ai/precedent-filter'
import type { Precedent, StepPrecedent } from '@/shared/ai/retrieval'

/** Сколько знаков шага-прецедента уходит мастеру — как у MCP и прежней раскопки. */
const STEP_CLIP = 240

/**
 * НА ЧТО МАСТЕР ОПИРАЕТСЯ: списки И шаги из нашей библиотеки, отобранные линзой его ремесла.
 *
 * ⚠️ Шаги запрашивались и выбрасывались: поиск возвращал и похожие списки, и отдельные
 * шаги похожих списков, а до мастера доезжали только списки. Для списков с бедным
 * описанием самое полезное — именно шаги, и за их поиск каждый ход платил впустую
 * (поймало авто-ревью #957). MCP и прежняя раскопка шаги отдают.
 *
 * Линза одна на оба вида. Если СВОЁ нашлось хоть в одном из них — отдаём только своё:
 * подмешать к нему общий фолбэк другого вида значило бы выдать чужую жилу за опору по
 * ремеслу, ведь пометка «не твоё ремесло» ставится на всё сразу. Своего нет нигде —
 * отдаём общее и честно помечаем.
 */
export function craftBasis(
  found: { lists: Precedent[]; steps: StepPrecedent[] },
  domains: string[],
): { precedents: string[]; offCraft: boolean } {
  const lists = pickPrecedentsDetailed(found.lists, domains)
  const steps = pickPrecedentsDetailed(found.steps, domains)
  const own = lists.matched || steps.matched
  const listLines = (!own || lists.matched ? lists.items : []).map((p) => `${p.title}${p.desc ? ' — ' + p.desc : ''}`)
  const stepLines = (!own || steps.matched ? steps.items : []).map((s) => s.content.slice(0, STEP_CLIP))
  const precedents = [...listLines, ...stepLines]
  return { precedents, offCraft: precedents.length > 0 && !own }
}
