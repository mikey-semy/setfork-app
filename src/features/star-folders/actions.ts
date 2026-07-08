'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, starFolders, starFolderItems, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/features/library/access'

/** Создать папку для звёзд. Уникальна по (user, name). */
export async function createStarFolder(name: string): Promise<{ id: string } | { error: string }> {
  const s = await requireSession()
  const n = name.trim().slice(0, 60)
  if (!n) return { error: 'empty' }
  try {
    const [f] = await db.insert(starFolders).values({ userId: s.userId, name: n }).returning({ id: starFolders.id })
    revalidatePath(`/${s.handle}`)
    return { id: f.id }
  } catch {
    return { error: 'exists' } // нарушение unique(user, name)
  }
}

export async function renameStarFolder(id: string, name: string): Promise<void> {
  const s = await requireSession()
  const n = name.trim().slice(0, 60)
  if (!n) return
  await db.update(starFolders).set({ name: n }).where(and(eq(starFolders.id, id), eq(starFolders.userId, s.userId)))
  revalidatePath(`/${s.handle}`)
}

export async function deleteStarFolder(id: string): Promise<void> {
  const s = await requireSession()
  await db.delete(starFolders).where(and(eq(starFolders.id, id), eq(starFolders.userId, s.userId)))
  revalidatePath(`/${s.handle}`)
}

/** Добавить/убрать список из папки (toggle). Владение папкой проверяется. */
export async function toggleListInFolder(folderId: string, templateId: string): Promise<void> {
  const s = await requireSession()
  const [f] = await db
    .select({ id: starFolders.id })
    .from(starFolders)
    .where(and(eq(starFolders.id, folderId), eq(starFolders.userId, s.userId)))
    .limit(1)
  if (!f) return // не своя папка
  const [existing] = await db
    .select({ id: starFolderItems.id })
    .from(starFolderItems)
    .where(and(eq(starFolderItems.folderId, folderId), eq(starFolderItems.templateId, templateId)))
    .limit(1)
  if (existing) {
    await db.delete(starFolderItems).where(eq(starFolderItems.id, existing.id)) // убрать можно всегда
  } else {
    // Добавить можно только видимый список — нельзя класть в папку чужой приватный/скрытый
    // (иначе оракул существования по рендеру папки).
    const [tpl] = await db
      .select({ ownerId: templates.ownerId, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1)
    if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === s.userId })) return
    await db.insert(starFolderItems).values({ folderId, templateId })
  }
  revalidatePath('/', 'layout')
}
