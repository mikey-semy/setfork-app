import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, passkeys, users } from '@/shared/db'
import { signInMethodsCount } from '@/shared/auth/identities'

// Ядро удаления passkey — БЕЗ 'use server'. Здесь функция принимает userId аргументом, и это
// нормально: модуль не является сетевой точкой входа, личность в него передаёт вызывающий,
// взяв её из сессии. Тот же приём, что у signed-cookies и остальных ядер фич.

export type PasskeyRemoval = 'removed' | 'not-found' | 'last-method'

/**
 * Удаление БЕЗ сессии — чтобы правило можно было проверить тестом, а не только кликом.
 *
 * ПРАВИЛО ПОСЛЕДНЕГО СПОСОБА ВХОДА действует и здесь. Оно было заведено при отвязке
 * провайдера, а удаление ключа шло мимо: у человека, чей единственный вход — passkey,
 * удаление закрывало дверь снаружи навсегда, и вернуть доступ мог бы только владелец
 * инстанса руками. Замечание авто-ревью на #782 (P1), непрочитанное: PR смержили, тред
 * остался открытым, дыра уехала в прод.
 *
 * Всё под замком строки пользователя: проверка и удаление двумя запросами разрешают две
 * попытки разом — обе видят «способов два» и обе срабатывают.
 */
export async function removePasskey(userId: string, id: string): Promise<PasskeyRemoval> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${users} where ${users.id} = ${userId} for update`)
    const [row] = await tx
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .limit(1)
    if (!row) return 'not-found'
    if ((await signInMethodsCount(userId, tx)) <= 1) return 'last-method'
    await tx.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    return 'removed'
  })
}
