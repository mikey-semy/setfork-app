import 'server-only'
import { inArray, sql } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

/** Люди по идентификаторам и почтам: подписи авторов коммитов и соавторов. */

/**
 * Наши пользователи по e-mail подписей git-коммитов (ключ — e-mail в нижнем
 * регистре). Подпись коммита ставит сам автор и совпадать с аккаунтом не обязана —
 * кто не нашёлся, показывается именем из подписи.
 */
export async function getUsersByEmails(emails: string[]): Promise<Record<string, { handle: string; name: string | null; avatarUrl: string | null }>> {
  const uniq = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (uniq.length === 0) return {}
  const rows = await db
    .select({ email: users.email, handle: users.handle, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(sql`lower(${users.email})`, uniq))
  // Аватары резолвим ПАРАЛЛЕЛЬНО: в цикле с await это был бы один поход за другим
  // на каждого автора коммита (тот же приём, что в getSuggestionAssignees).
  const resolved = await Promise.all(
    rows
      .filter((r) => r.email)
      .map(async (r) => [r.email!.toLowerCase(), { handle: r.handle, name: r.name, avatarUrl: await avatarSrc(r.avatarUrl, 48) }] as const),
  )
  return Object.fromEntries(resolved)
}

/**
 * Пользователи по id — соавторы предложения (`coauthor_ids`).
 *
 * Рядом с `getUsersByEmails` и по её же схеме: аватары резолвятся параллельно,
 * потому что подпись URL — сетевая операция, а соавторов бывает несколько.
 */
export async function getUsersByIds(ids: string[]): Promise<{ handle: string; name: string | null; avatarUrl: string | null }[]> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (uniq.length === 0) return []
  const rows = await db
    .select({ handle: users.handle, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, uniq))
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}
