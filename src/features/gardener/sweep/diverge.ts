/**
 * ПРАВИЛО ОСТАНОВКИ И РАСХОЖДЕНИЕ ФОРКОМ.
 *
 * Решение владельца: «нужно понимать, когда стоит остановиться в улучшении и начать делать
 * аналогии с форками, потому что бывает так, что улучшения только портят». Список, который
 * два прохода подряд не меняется, УЖЕ хорош настолько, насколько его умеет сделать машина.
 * Третий проход по нему — не улучшение, а трата денег и риск испортить.
 *
 * Что вместо: РАСХОЖДЕНИЕ. Другой профильный мастер форкает список и уводит его в другой
 * контекст — не «лучше», а ДЛЯ ДРУГОГО СЛУЧАЯ (бюджет, съёмное жильё, команда вместо
 * одиночки, другой уровень подготовки). Так растёт покрытие, а не глянец: два разных списка
 * полезнее одного отполированного.
 *
 * Счётчик берём из журнала действий — он и так пишется, отдельного состояния не надо.
 *
 * Причина измениться у модуля одна: когда меняется ответ на вопрос «полировать дальше
 * или разойтись».
 */

import 'server-only'
import { listStore } from '@/features/library/list-store'
import { enqueueReindex } from '@/features/library/jobs'
import { generateListRefine, type GeneratedItem } from '@/shared/ai/generate'
import type { ListKind } from '@/shared/ai/list-kind'
import { policyFor } from '@/shared/ai/gardener-policies'
import { globalBudgetOk } from '@/shared/quota'
import { log } from '@/shared/observability'
import { toProposed, toStepInput } from '@/shared/lib/step-input'
import { professionOf, tenderForTags } from '@/shared/ai/gnome-account'
import { recordAgentAction } from '@/shared/agents/policy'
import type { Expert } from '@/shared/ai/roster'
import type { Lang, LocaleText } from '@/shared/i18n'
import { uniqueSlug } from '@/shared/lib/slug'

export const STABLE_PASSES_BEFORE_FORK = 2

/**
 * Расхождение форком: другой мастер берёт устоявшийся список и уводит в ДРУГОЙ контекст.
 * Форк — черновик: публиковать его будет гейт готовности, как и всё остальное.
 */
export async function divergeByFork(
  tpl: { id: string; slug: string; desc: LocaleText | null; tags: string[] },
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] },
  lang: Lang,
  kind: ListKind,
  ctx: { roster: Expert[]; excludeUserId: string; agents: string[]; policyVersion: number },
): Promise<boolean> {
  // Форкает ДРУГОЙ мастер: тот же гном по тому же списку даст ту же полировку.
  const other = await tenderForTags(tpl.tags, ctx.roster.filter((e) => e.userId !== ctx.excludeUserId))
  if (!other?.userId) return false
  if (!(await globalBudgetOk())) return false

  const instruction = `${policyFor(kind, {})}
DIVERGE, do not polish. The list is already good for its original case. Produce a variant for a DIFFERENT concrete situation of the same topic (tighter budget, rented place, a team instead of one person, a different skill level, another climate or season). Change what the situation actually changes and keep the shape. Name the situation in the first item's description.`
  const variant = await generateListRefine(current, instruction, lang, { userId: other.userId, feature: 'refine', refType: 'template', refId: tpl.id, kind })
  if (!variant || !variant.items.length) return false

  const slug = await uniqueSlug(variant.title || current.title, other.userId)
  const created = await listStore.create({
    ownerId: other.userId,
    slug,
    title: { [lang]: variant.title || current.title },
    desc: variant.desc ? { [lang]: variant.desc } : (tpl.desc ?? {}),
    tags: variant.tags.length ? variant.tags.slice(0, 8) : tpl.tags,
    ordered: true,
    visibility: 'public',
    // Черновик: расхождение — гипотеза, а не улучшение. Публикует гейт готовности.
    status: 'draft',
    origin: 'forked',
    forkedFromId: tpl.id,
    note: `diverged from ${tpl.slug}`,
    steps: toStepInput(toProposed(variant.items, lang)),
  })
  await enqueueReindex(created.id)
  await recordAgentAction({
    loop: 'gardener',
    action: 'list.fork',
    resultStatus: 'ok',
    agentId: other.expert.id,
    actorUserId: other.userId,
    signal: { templateId: tpl.id, slug: tpl.slug, reason: 'stable for 2 passes - polishing further only risks harm' },
    decision: { mode: 'diverge', profession: professionOf(other.expert, 'en'), newSlug: slug },
    resultRef: slug,
    policyVersion: ctx.policyVersion,
  })
  log.info('gardener: diverged by fork', { from: tpl.slug, to: slug, by: other.expert.id })
  return true
}
