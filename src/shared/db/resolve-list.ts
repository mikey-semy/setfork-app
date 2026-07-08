import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, templates, users } from './index'

/** Резолв списка по handle владельца и slug — ровно поля для canViewList (@/core).
 *  Единый лукап для server actions и роутов (был скопипащен в трёх местах). */
export async function resolveListBySlug(owner: string, slug: string) {
  const [row] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return row ?? null
}
