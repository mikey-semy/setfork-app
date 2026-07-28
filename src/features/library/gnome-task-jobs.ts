import 'server-only'
import { isLang, type Lang } from '@/shared/i18n'
import { runGnomeIssueTask } from './gnome-task'

/**
 * Гном выполняет назначенную задачу — фоном.
 *
 * Как и у ревью: вызов модели идёт секунды и может отвалиться, а держать на нём
 * экшен назначения значило бы, что человек ждёт спиннер и при таймауте теряет
 * само назначение.
 */
export async function runGnomeTaskJob(raw: unknown): Promise<void> {
  const payload = (raw ?? {}) as Record<string, unknown>
  const issueId = String(payload.issueId ?? '')
  const expertId = String(payload.expertId ?? '')
  const langRaw = String(payload.lang ?? 'en')
  const lang: Lang = isLang(langRaw) ? langRaw : 'en'
  if (!issueId || !expertId) return

  // Не состоялось по смыслу (задачу закрыли, гном уже работает, бюджет исчерпан)
  // — не сбой джобы: повтор дал бы тот же ответ.
  await runGnomeIssueTask(issueId, expertId, lang)
}
