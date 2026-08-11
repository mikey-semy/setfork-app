// Принятие предложения ИЗ ПУНКТОВ — новой версией списка.
// Причина измениться одна: что происходит, когда правку принимают без git.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, suggestions } from '@/shared/db'
import { toStepInput } from '@/shared/lib/step-input'
import { listStore } from '../list-store'
import { enqueueReindex } from '../jobs'
import { withPrDefaults } from '../pr-settings'
import { closeLinkedIssues, notifyWatchersNewVersion } from '../suggestion-side-effects'
// eslint-disable-next-line boundaries/dependencies -- уведомления автору и наблюдателям: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'
import { reviewGates } from './gates'
import { currentRevision } from './revision'

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

  // Ворота — те же, что у слияния ветки, и проверяются ЗДЕСЬ, а не в экшене: через
  // MCP правку принимают тем же ядром, и правила не должны зависеть от того, пришёл
  // человек со страницы или агент.
  const prs = withPrDefaults(sug.template.prSettings)
  const blocked = await reviewGates(sug, prs, await currentRevision(sug))
  if (blocked) return { ok: false, reason: blocked }

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
