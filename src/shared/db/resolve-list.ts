import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, templates, users } from './index'

/** Резолв списка по handle владельца и slug — ровно поля для canViewList и
 *  canWriteToFeature (@/core). Единый лукап для server actions и роутов (был
 *  скопипащен в трёх местах).
 *
 *  Состояние разделов входит в проекцию не «на всякий случай»: без него write-action
 *  физически не может проверить, включён ли раздел, и проверка остаётся только на
 *  странице — то есть там, где сохранённая форма её не встретит. */
export async function resolveListBySlug(owner: string, slug: string) {
  const [row] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
      issuesEnabled: templates.issuesEnabled,
      discussionsEnabled: templates.discussionsEnabled,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return row ?? null
}
