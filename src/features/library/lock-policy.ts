import 'server-only'
// eslint-disable-next-line boundaries/dependencies -- права коллаборанта: тот же кросс-фич-паттерн, что в actions.ts
import { isCollaborator } from '@/features/collab/queries'

/**
 * КТО МОЖЕТ ОТВЕЧАТЬ В ЗАПЕРТОМ ОБСУЖДЕНИИ — ОДНО ПРАВИЛО НА ВСЕ ПОВЕРХНОСТИ.
 *
 * ⚠️ У нас было ТРИ разных ответа на один вопрос: у задач отвечали ведущие раздел (#881),
 * у предложений — никто, включая владельца, у тредов на блоках — тоже никто. Человек не
 * должен держать в голове, где ему можно ответить: разнобой хуже любого из вариантов.
 *
 * Форма взята у большинства, и она же совпадает с нашими задачами:
 *  • Gitea, `models/issues/issue_lock.go`: «This would limit commenting abilities to
 *    users with write access to the repo»;
 *  • GitLab, `app/policies/merge_request_policy.rb`: `rule { locked & ~is_container_member }
 *    .policy do prevent :create_note` — замок отсекает НЕ-членов, члены отвечают.
 *
 * Замок при этом не про состояние: закрыть, переоткрыть и слить он не мешает — там свои
 * права (см. rejectSuggestion/reopenSuggestion).
 */
export async function canSpeakWhenLocked(templateOwnerId: string, templateId: string, userId: string): Promise<boolean> {
  return templateOwnerId === userId || (await isCollaborator(templateId, userId))
}
