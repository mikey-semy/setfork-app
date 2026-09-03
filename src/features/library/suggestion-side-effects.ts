import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { db, issues } from '@/shared/db'
import { captureError } from '@/shared/observability'
// eslint-disable-next-line boundaries/dependencies -- уведомления: тот же кросс-фич-паттерн, что в actions.ts
import { notify, notifyMany } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- список наблюдателей живёт в watch
import { getWatcherIds } from '@/features/watch/queries'
import { closingRefs } from './closing-refs'
// eslint-disable-next-line boundaries/dependencies -- след в ленте задачи: тот же кросс-фич-паттерн, что уведомления выше
import { recordIssueEvent } from '@/features/issues/events'

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
export async function closeLinkedIssues(
  templateId: string,
  text: string,
  actorId: string,
  enabled: boolean,
  /** Правка, которая закрывает задачи: попадёт в ленту задачи отметкой «закрыта правкой №N». */
  suggestion?: { id: string },
): Promise<void> {
  if (!enabled) return
  const nums = closingRefs(text)
  if (nums.length === 0) return
  try {
    const rows = await db
      .select({ id: issues.id, number: issues.number, authorId: issues.authorId })
      .from(issues)
      .where(and(eq(issues.templateId, templateId), inArray(issues.number, nums), eq(issues.status, 'open')))
    for (const iss of rows) {
      // ⚠️ ИСХОД СТАВИТСЯ И ЗДЕСЬ. Без него у задач, закрытых принятой правкой, поле
      // осталось бы пустым навсегда — а это как раз самый частый способ закрытия, и
      // фильтр «сделано» их бы не показывал. Работа сделана: правка в main.
      // Так же у GitHub: закрытие через PR ставит `state_reason: completed` — проверено
      // на живых данных (50 закрытых задач vercel/next.js, у всех `completed`).
      await db
        .update(issues)
        .set({ status: 'closed', closedAt: new Date(), closeReason: 'completed', duplicateOfId: null })
        .where(eq(issues.id, iss.id))
      // Отметка в ленте задачи: чем именно её закрыли. Без неё автор видит закрытую
      // задачу и не знает, что поменялось, — а первый вопрос у него ровно этот.
      await recordIssueEvent(db, {
        issueId: iss.id,
        actorId,
        kind: 'closed_by_suggestion',
        suggestionId: suggestion?.id,
        closeReason: 'completed',
      })
      if (iss.authorId !== actorId) {
        await notify({ recipientId: iss.authorId, actorId, type: 'issue_closed_by_merge', templateId, issueId: iss.id })
      }
    }
  } catch (e) {
    captureError(e, { where: 'closeLinkedIssues' })
  }
}


/**
 * Рассылка следящим — ПОСЛЕ точки невозврата, поэтому она не имеет права ронять
 * действие. `notify` внутри себя ошибки уже глотает, а вот чтение списка следящих —
 * нет: обрыв соединения к базе (на этой машине их приносит порт-прокси Docker) уронил
 * бы слияние ПОСЛЕ того, как ветка влита и статус проставлен. Человек увидел бы
 * ошибку на удавшемся слиянии, а повторное нажатие ответило бы «уже принято».
 *
 * Тот же вывод записан у садовника (`sweep/publish.ts`): порядок здесь нагружен, и в
 * худшем случае теряется уведомление — только оно.
 */
export async function notifyWatchersNewVersion(templateId: string, actorId: string): Promise<void> {
  try {
    const watchers = await getWatcherIds(templateId, 'versions')
    await notifyMany(watchers, { actorId, type: 'new_version', templateId })
  } catch (e) {
    captureError(e, { where: 'notifyWatchersNewVersion', templateId })
  }
}

