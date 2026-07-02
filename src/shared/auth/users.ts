// Upsert пользователя после логина (GitHub или demo).
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import type { SessionUser } from './session'

export async function upsertGithubUser(gh: {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
}): Promise<SessionUser> {
  const existing = await db.select().from(users).where(eq(users.githubId, gh.id)).limit(1)
  if (existing[0]) {
    // Синхронизируем только handle; имя/аватар не перезатираем — их пользователь
    // мог настроить в /settings (в т.ч. загрузить свой аватар).
    const [u] = await db
      .update(users)
      .set({ handle: gh.login })
      .where(eq(users.id, existing[0].id))
      .returning()
    return toSession(u)
  }
  const [u] = await db
    .insert(users)
    .values({ githubId: gh.id, handle: gh.login, name: gh.name, avatarUrl: gh.avatar_url })
    .returning()
  return toSession(u)
}

/** Demo-пользователь (dev-фолбэк без GitHub OAuth). Один общий demo-аккаунт. */
export async function getOrCreateDemoUser(): Promise<SessionUser> {
  const existing = await db.select().from(users).where(eq(users.handle, 'demo')).limit(1)
  if (existing[0]) return toSession(existing[0])
  const [u] = await db.insert(users).values({ handle: 'demo', name: 'Demo User' }).returning()
  return toSession(u)
}

function toSession(u: typeof users.$inferSelect): SessionUser {
  return { userId: u.id, handle: u.handle, name: u.name ?? undefined, avatarUrl: u.avatarUrl ?? undefined }
}
