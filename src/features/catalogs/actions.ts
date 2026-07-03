'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, repositories, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { slugify } from '@/features/library/slug'

async function ownTemplate(templateId: string, userId: string) {
  const [tpl] = await db
    .select({ id: templates.id, ownerId: templates.ownerId, slug: templates.slug })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  return tpl && tpl.ownerId === userId ? tpl : null
}

/** Создать каталог и положить в него текущий список (владелец). */
export async function createCatalogAndAssign(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await ownTemplate(templateId, session.userId)
  if (!tpl) return
  const raw = String(formData.get('name') ?? '').trim()
  const name = slugify(raw)
  if (!name) return

  const [repo] = await db
    .insert(repositories)
    .values({ ownerId: session.userId, name, title: { [lang]: raw } })
    .onConflictDoNothing()
    .returning({ id: repositories.id })
  let repoId = repo?.id
  if (!repoId) {
    const [ex] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.ownerId, session.userId), eq(repositories.name, name)))
      .limit(1)
    repoId = ex?.id
  }
  if (repoId) await db.update(templates).set({ repositoryId: repoId }).where(eq(templates.id, templateId))

  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
  revalidatePath(`/${session.handle}`)
}

/** Переместить список в существующий каталог или убрать (catalogId '' = solo). */
export async function setListCatalog(templateId: string, catalogId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await ownTemplate(templateId, session.userId)
  if (!tpl) return
  let repoId: string | null = null
  if (catalogId) {
    const [repo] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.id, catalogId), eq(repositories.ownerId, session.userId)))
      .limit(1)
    if (!repo) return
    repoId = repo.id
  }
  await db.update(templates).set({ repositoryId: repoId }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
  revalidatePath(`/${session.handle}`)
}

/** Удалить каталог (списки становятся solo). */
export async function deleteCatalog(catalogId: string): Promise<void> {
  const session = await requireSession()
  const [repo] = await db
    .select({ id: repositories.id, name: repositories.name })
    .from(repositories)
    .where(and(eq(repositories.id, catalogId), eq(repositories.ownerId, session.userId)))
    .limit(1)
  if (!repo) return
  await db.update(templates).set({ repositoryId: null }).where(eq(templates.repositoryId, catalogId))
  await db.delete(repositories).where(eq(repositories.id, catalogId))
  revalidatePath(`/${session.handle}`)
}
