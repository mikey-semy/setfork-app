import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { CatalogStore } from '@/core'
import { db, repositories, templates } from '@/shared/db'

// Адаптер порта CatalogStore (repositories). Auth/revalidate — в server-actions.
export const catalogStore: CatalogStore = {
  async ensure(ownerId, name, title) {
    const [repo] = await db.insert(repositories).values({ ownerId, name, title }).onConflictDoNothing().returning({ id: repositories.id })
    if (repo) return repo.id
    const [ex] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.ownerId, ownerId), eq(repositories.name, name)))
      .limit(1)
    return ex?.id ?? null
  },

  async setListCatalog(listId, catalogId) {
    await db.update(templates).set({ repositoryId: catalogId }).where(eq(templates.id, listId))
  },

  async remove(catalogId, ownerId) {
    // Одной транзакцией и с замком на строке полки. Тремя отдельными запросами удаление
    // разъезжалось с пакетной раскладкой: та успевала положить списки на полку в зазоре
    // между «сняли жильцов» и «удалили полку», и они оставались указывать на исчезнувшую —
    // внешнего ключа у `repositoryId` нет, база такого не ловит (находка авто-ревью).
    // Тот же замок берёт раскладка, поэтому теперь эти двое ждут друг друга.
    await db.transaction(async (tx) => {
      const [repo] = await tx
        .select({ id: repositories.id })
        .from(repositories)
        .where(and(eq(repositories.id, catalogId), eq(repositories.ownerId, ownerId)))
        .limit(1)
        .for('update')
      if (!repo) return
      await tx.update(templates).set({ repositoryId: null }).where(eq(templates.repositoryId, catalogId))
      await tx.delete(repositories).where(eq(repositories.id, catalogId))
    })
  },
}
