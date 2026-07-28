import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { db, issues } from '@/shared/db'
import { captureError } from '@/shared/observability'
// eslint-disable-next-line boundaries/dependencies -- уведомления: тот же кросс-фич-паттерн, что в actions.ts
import { notify, notifyMany } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- список наблюдателей живёт в watch
import { getWatcherIds } from '@/features/watch/queries'
import { closingRefs } from './closing-refs'

// Побочные эффекты принятия правки, общие для страницы и для ядра.
//
// Файл БЕЗ 'use server' намеренно: и экшены, и ядро принятия зовут это на сервере,
// а экспорт из экшен-файла означал бы сетевую точку входа с чужим actorId в аргументе.

/**
 * Закрыть задачи, названные в тексте предложения («closes #12», «закрывает #7»).
 *
 * Вызывается ПОСЛЕ успешного слияния: до него задача ещё не решена. Ошибки не
 * поднимаем — предложение уже влито, и падать из-за побочного эффекта нельзя.
 */
export async function closeLinkedIssues(templateId: string, text: string, actorId: string, enabled: boolean): Promise<void> {
  if (!enabled) return
  const nums = closingRefs(text)
  if (nums.length === 0) return
  try {
    const rows = await db
      .select({ id: issues.id, number: issues.number, authorId: issues.authorId })
      .from(issues)
      .where(and(eq(issues.templateId, templateId), inArray(issues.number, nums), eq(issues.status, 'open')))
    for (const iss of rows) {
      await db.update(issues).set({ status: 'closed', closedAt: new Date() }).where(eq(issues.id, iss.id))
      if (iss.authorId !== actorId) {
        await notify({ recipientId: iss.authorId, actorId, type: 'issue_closed_by_merge', templateId, issueId: iss.id })
      }
    }
  } catch (e) {
    captureError(e, { where: 'closeLinkedIssues' })
  }
}


export async function notifyWatchersNewVersion(templateId: string, actorId: string): Promise<void> {
  const watchers = await getWatcherIds(templateId, 'versions')
  await notifyMany(watchers, { actorId, type: 'new_version', templateId })
}

