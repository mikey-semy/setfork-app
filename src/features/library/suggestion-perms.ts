import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, suggestionAssignees } from '@/shared/db'
// eslint-disable-next-line boundaries/dependencies -- права коллаборанта живут в collab
import { isCollaborator } from '@/features/collab/queries'
import { withPrDefaults } from './pr-settings'

/**
 * Кто может править ПУНКТЫ предложения.
 *
 * Отдельный модуль, а не экспорт из `actions.ts`: там стоит `'use server'`, и
 * каждый экспорт оттуда становится сетевой точкой входа. Предикату прав быть
 * вызываемым снаружи незачем — а страница и экшен должны спрашивать ОДНО И ТО ЖЕ
 * правило, иначе кнопка и обработчик снова разъедутся (это уже случалось с
 * гейтами слияния).
 *
 * Автор — всегда: до сих пор он не мог поправить даже собственную опечатку, вся
 * правка была «одним выстрелом». Исполнители — потому что их назначили именно
 * работать над ней. Владелец и коллаборанты — только если список это разрешает
 * («Allow edits by maintainers» у GitHub): правка чужого текста без спроса
 * недопустима.
 */
export async function canEditSuggestionItems(
  sug: { id: string; authorId: string; templateId: string; template: { ownerId: string; prSettings: unknown } },
  userId: string,
): Promise<boolean> {
  if (sug.authorId === userId) return true
  const [assigned] = await db
    .select({ id: suggestionAssignees.id })
    .from(suggestionAssignees)
    .where(and(eq(suggestionAssignees.suggestionId, sug.id), eq(suggestionAssignees.userId, userId)))
    .limit(1)
  if (assigned) return true
  if (!withPrDefaults(sug.template.prSettings).allowMaintainerEdits) return false
  return sug.template.ownerId === userId || (await isCollaborator(sug.templateId, userId))
}
