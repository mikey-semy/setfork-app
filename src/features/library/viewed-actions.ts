'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, suggestions, suggestionViewed, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

/**
 * Отметить пункт просмотренным — как «Viewed» у файла в GitHub.
 *
 * Отметка ЛИЧНАЯ: это состояние ревьюера, а не свойство правки. Поэтому права
 * проверяются минимально — достаточно видеть предложение; ставить галочку «за
 * себя» может любой, кто его читает, и чужого состояния он этим не меняет.
 *
 * `fingerprint` — отпечаток содержимого пункта на момент отметки. Хранится,
 * чтобы отличить честное «просмотрено» от «просмотрено ДО того, как пункт
 * переписали».
 */
export async function toggleViewed(suggestionId: string, blockId: string, fingerprint: string): Promise<void> {
  const session = await requireSession()
  if (!blockId) return // у пункта нет идентичности — отмечать нечего

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return

  const [existing] = await db
    .select({ id: suggestionViewed.id })
    .from(suggestionViewed)
    .where(
      and(
        eq(suggestionViewed.suggestionId, suggestionId),
        eq(suggestionViewed.userId, session.userId),
        eq(suggestionViewed.blockId, blockId),
      ),
    )
    .limit(1)

  if (existing) {
    await db.delete(suggestionViewed).where(eq(suggestionViewed.id, existing.id))
  } else {
    await db
      .insert(suggestionViewed)
      .values({ suggestionId, userId: session.userId, blockId, atFingerprint: fingerprint.slice(0, 64) })
      // Двойной клик/гонка вкладок не должны падать: отметка идемпотентна.
      .onConflictDoNothing()
  }

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, sug.template.ownerId)).limit(1)
  if (owner) revalidatePath(`/${owner.handle}/${sug.template.slug}/suggestions/${sug.number ?? sug.id}`)
}
