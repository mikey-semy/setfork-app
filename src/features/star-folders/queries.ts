import 'server-only'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, starFolders, starFolderItems } from '@/shared/db'

export interface StarFolder {
  id: string
  name: string
  count: number
}

/** Папки пользователя + число списков в каждой. */
export async function getUserFolders(userId: string): Promise<StarFolder[]> {
  return db
    .select({
      id: starFolders.id,
      name: starFolders.name,
      count: sql<number>`(select count(*)::int from ${starFolderItems} i where i.folder_id = ${starFolders.id})`,
    })
    .from(starFolders)
    .where(eq(starFolders.userId, userId))
    .orderBy(asc(starFolders.name))
}

/** ID папок, в которых лежит данный список у пользователя (для чекбоксов в звезде). */
export async function getFoldersForTemplate(userId: string, templateId: string): Promise<string[]> {
  const rows = await db
    .select({ folderId: starFolderItems.folderId })
    .from(starFolderItems)
    .innerJoin(starFolders, eq(starFolders.id, starFolderItems.folderId))
    .where(and(eq(starFolders.userId, userId), eq(starFolderItems.templateId, templateId)))
  return rows.map((r) => r.folderId)
}

/** templateId'ы в папке по имени (для фильтра starred на профиле). null — папки нет. */
export async function getFolderTemplateIds(userId: string, folderName: string): Promise<string[] | null> {
  const [f] = await db
    .select({ id: starFolders.id })
    .from(starFolders)
    .where(and(eq(starFolders.userId, userId), eq(starFolders.name, folderName)))
    .limit(1)
  if (!f) return null
  const rows = await db.select({ t: starFolderItems.templateId }).from(starFolderItems).where(eq(starFolderItems.folderId, f.id))
  return rows.map((r) => r.t)
}
