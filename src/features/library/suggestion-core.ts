import 'server-only'
import { eq } from 'drizzle-orm'
import { db, suggestions } from '@/shared/db'
import { toStepInput } from '@/shared/lib/step-input'
// eslint-disable-next-line boundaries/dependencies -- уведомления автору и наблюдателям: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'
import { listStore } from './list-store'
import { enqueueReindex } from './jobs'
import { withPrDefaults } from './pr-settings'
import { countApprovals, hasBlockingReview } from './review-actions'
// eslint-disable-next-line boundaries/dependencies -- счётчик нерешённых обсуждений живёт в comments
import { countUnresolvedThreads } from '@/features/comments/queries'
import { closeLinkedIssues, notifyWatchersNewVersion } from './suggestion-side-effects'

/**
 * ЯДРО принятия правки — БЕЗ 'use server'.
 *
 * Модуль отдельный не для порядка, а по необходимости: любой экспорт из файла с
 * 'use server' — это сетевая точка входа, которую клиент зовёт с ЛЮБЫМИ аргументами.
 * У этой функции личность действующего лица приходит аргументом (`actorUserId`), и в
 * экшен-файле она означала бы «примите правку от имени владельца, чей id я подставил»:
 * гейт `ownerId !== actorUserId` сверялся бы с числом, которое прислал нападающий.
 *
 * Здесь функция обычная: её зовут сервером — экшен со своей сессией и MCP с userId
 * токена. Ни один из них не берёт личность из запроса.
 */
export async function applySuggestion(
  suggestionId: string,
  actorUserId: string,
): Promise<{ ok: true; templateId: string; slug: string; version: number } | { ok: false; reason: string }> {
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'open') return { ok: false, reason: `already ${sug.status}` }
  if (sug.template.ownerId !== actorUserId) return { ok: false, reason: 'not your list' }
  if (sug.draft) return { ok: false, reason: 'draft' } // черновик не принимаем — см. mergeBranchPr
  // Запрошенные правки блокируют принятие — иначе вердикт «просит доработать»
  // был бы декоративным. Разблокировать может сам рецензент, сменив свой голос.
  if (await hasBlockingReview(sug.id)) return { ok: false, reason: 'a reviewer requested changes' }
  // Остальные гейты — по настройкам списка (раздел «Предложения»). Проверяем ЗДЕСЬ,
  // а не в экшене: через MCP правку принимают тем же ядром, и гейты не должны
  // зависеть от того, пришёл человек со страницы или агент.
  const prs = withPrDefaults(sug.template.prSettings)
  if (prs.blockOnUnresolved && (await countUnresolvedThreads(sug.id))) return { ok: false, reason: 'unresolved discussions' }
  if (prs.requiredApprovals > 0 && (await countApprovals(sug.id)) < prs.requiredApprovals)
    return { ok: false, reason: `needs ${prs.requiredApprovals} approval(s)` }

  const tpl = sug.template
  // Новая версия из принятого предложения — через доменный порт.
  const ver = await listStore.addVersion(tpl.id, { note: sug.note || 'suggested edit', steps: toStepInput(sug.items), authorId: actorUserId })
  // Пере-проверку делает фасад listStore.addVersion (барьер) — здесь не дублируем.
  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  // «closes #12» в заметке закрывает задачи — но только теперь, когда изменения приняты.
  await closeLinkedIssues(tpl.id, sug.note, actorUserId, prs.autoCloseIssues)
  await notify({ recipientId: sug.authorId, actorId: actorUserId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  await notifyWatchersNewVersion(tpl.id, actorUserId)
  await enqueueReindex(tpl.id)
  return { ok: true, templateId: tpl.id, slug: tpl.slug, version: ver.version }
}

