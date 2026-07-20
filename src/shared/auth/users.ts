// Upsert пользователя после логина (OAuth или demo).
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { uniqueHandle } from './handle'
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

export type OauthProfile = {
  /** id пользователя у провайдера (у Яндекса строка, у VK число). */
  externalId: string | number
  /** Кандидаты для handle в порядке предпочтения (логин, local-part email, имя). */
  handleCandidates: Array<string | null | undefined>
  name: string | null
  avatarUrl: string | null
  /** Верифицированный провайдером email; занят другим аккаунтом → не пишем. */
  email?: string | null
}

/**
 * Вход через Яндекс/VK: находим по внешнему id или создаём. handle генерим сами
 * (у провайдера может не быть логина) и дальше НЕ синхронизируем — он наш.
 */
export async function upsertOauthUser(provider: 'yandex' | 'vk', p: OauthProfile): Promise<SessionUser> {
  const byExternalId =
    provider === 'yandex' ? eq(users.yandexId, String(p.externalId)) : eq(users.vkId, Number(p.externalId))
  const [existing] = await db.select().from(users).where(byExternalId).limit(1)
  if (existing) return toSession(existing)

  const idValue = provider === 'yandex' ? { yandexId: String(p.externalId) } : { vkId: Number(p.externalId) }
  let email: string | null = p.email?.trim().toLowerCase() || null
  if (email) {
    const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (byEmail) email = null // не связываем аккаунты автоматически
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const handle = await uniqueHandle(attempt === 0 ? p.handleCandidates : [`${provider}-user`])
    try {
      const [u] = await db
        .insert(users)
        .values({
          ...idValue,
          handle,
          name: p.name,
          avatarUrl: p.avatarUrl,
          email,
          emailVerifiedAt: email ? new Date() : null,
        })
        .returning()
      return toSession(u)
    } catch (e) {
      // Гонка: параллельный вход тем же провайдер-аккаунтом или занятый handle/email.
      const [raced] = await db.select().from(users).where(byExternalId).limit(1)
      if (raced) return toSession(raced)
      email = null
      if (attempt === 1) throw e
    }
  }
  throw new Error('unreachable')
}

/** Demo-пользователь (dev-фолбэк без OAuth). Один общий demo-аккаунт. */
export async function getOrCreateDemoUser(): Promise<SessionUser> {
  const existing = await db.select().from(users).where(eq(users.handle, 'demo')).limit(1)
  if (existing[0]) return toSession(existing[0])
  const [u] = await db.insert(users).values({ handle: 'demo', name: 'Demo User' }).returning()
  return toSession(u)
}

function toSession(u: typeof users.$inferSelect): SessionUser {
  return { userId: u.id, handle: u.handle, name: u.name ?? undefined, avatarUrl: u.avatarUrl ?? undefined }
}
