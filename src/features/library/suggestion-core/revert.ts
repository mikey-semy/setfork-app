// Откат принятого предложения. Причина измениться одна: как считается, что
// именно внесла правка и можно ли это отменить безопасно.

import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, suggestions, type ProposedItem } from '@/shared/db'
import { revertPlan } from '../suggestion-revert'
import { getVersionSteps } from '../queries'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора живут в collab
import { isCollaborator } from '@/features/collab/queries'
import { createSuggestion } from './create'

/**
 * ОТКАТ принятого предложения — как Revert у GitHub.
 *
 * Откат НЕ правит историю тихо: он создаёт новое предложение, которое отменяет
 * старое и проходит те же ворота — ревью, гейты, слияние. Мгновенная отмена в обход
 * ревью была бы дырой ровно того размера, что и слияние без ревью.
 *
 * Отменяем ВКЛАД, а не «возвращаем список к старой версии»: между слиянием и
 * откатом список живёт своей жизнью, и откат к снимку затёр бы чужую работу. Что
 * именно внесла правка, считает `revertPlan` по идентичности блоков.
 *
 * Пункты, которые с тех пор трогали, возвращаются СПИСКОМ, а не разрешаются
 * догадкой: отменить их автоматически нельзя, и человек должен увидеть, какие
 * именно.
 */
export async function revertSuggestion(
  actorUserId: string,
  suggestionId: string,
): Promise<{ ok: true; id: string; number: number | null } | { ok: false; reason: string; conflicts?: { title: string }[] }> {
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'accepted') return { ok: false, reason: 'only an accepted suggestion can be reverted' }
  const tpl = sug.template
  if (tpl.ownerId !== actorUserId && !(await isCollaborator(tpl.id, actorUserId))) return { ok: false, reason: 'not a maintainer' }
  // Правки, принятые до появления этого поля, откату не поддаются: что именно они
  // внесли, пришлось бы угадывать по времени и тексту заметки.
  if (!sug.mergedVersion) return { ok: false, reason: 'accepted before revert existed — revert it by hand' }

  // Уже отменено — второй откат отменял бы отмену.
  const dup = await db.query.suggestions.findFirst({
    where: (s) => and(eq(s.revertOfId, sug.id), eq(s.status, 'open')),
  })
  if (dup) return { ok: false, reason: `already being reverted in #${dup.number ?? dup.id}` }

  const [before, after, current] = await Promise.all([
    getVersionSteps(tpl.id, sug.mergedVersion - 1),
    getVersionSteps(tpl.id, sug.mergedVersion),
    getVersionSteps(tpl.id, tpl.currentVersion),
  ])
  if (!after || !current) return { ok: false, reason: 'versions are gone' }

  const plan = revertPlan(
    (before?.steps ?? []) as unknown as ProposedItem[],
    after.steps as unknown as ProposedItem[],
    current.steps as unknown as ProposedItem[],
  )
  if (plan.conflicts.length > 0) {
    return {
      ok: false,
      reason: 'these items changed after the merge — revert cannot undo them safely',
      conflicts: plan.conflicts.map((c) => ({ title: c.title })),
    }
  }

  const head = sug.note.split(/\r?\n/)[0].trim().slice(0, 100)
  const created = await createSuggestion(actorUserId, tpl.id, {
    note: `Revert «${head || `#${sug.number ?? ''}`}»${sug.number ? ` (#${sug.number})` : ''}`,
    items: plan.items,
  })
  if (!created.ok) return created
  await db.update(suggestions).set({ revertOfId: sug.id }).where(eq(suggestions.id, created.id))
  return created
}
