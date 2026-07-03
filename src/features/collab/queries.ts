import 'server-only'
import { and, eq } from 'drizzle-orm'
import { collaborators, db, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

export async function isCollaborator(templateId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: collaborators.id })
    .from(collaborators)
    .where(and(eq(collaborators.templateId, templateId), eq(collaborators.userId, userId)))
    .limit(1)
  return !!row
}

/** Может ли пользователь писать в список (владелец или коллаборатор). */
export async function canWriteList(templateId: string, ownerId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  if (userId === ownerId) return true
  return isCollaborator(templateId, userId)
}

export interface CollaboratorRow {
  userId: string
  handle: string
  avatarUrl: string | null
  role: 'write'
}

export async function getCollaborators(templateId: string): Promise<CollaboratorRow[]> {
  const rows = await db
    .select({ userId: collaborators.userId, handle: users.handle, avatarUrl: users.avatarUrl, role: collaborators.role })
    .from(collaborators)
    .innerJoin(users, eq(collaborators.userId, users.id))
    .where(eq(collaborators.templateId, templateId))
    .orderBy(users.handle)
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}
