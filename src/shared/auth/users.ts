// Upsert пользователя после логина (OAuth или demo).
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { uniqueHandle } from './handle'
import type { SessionUser } from './session'

/**
 * Вход через GitHub: находим по githubId или создаём.
 *
 * handle НИКОГДА не берётся из `gh.login` напрямую и при повторном входе НЕ
 * синхронизируется. Логин на GitHub выбирает сам пользователь и переименовывается
 * когда угодно — сырая запись в `handle` обходила бы разом форму ника,
 * RESERVED_HANDLES, занятость и ADMIN_HANDLES, то есть давала privesc до админа
 * свободным (а через регистр букв — и занятым) админ-ником. Ник заводим один раз
 * через ту же воронку, что регистрация и Яндекс/VK (`uniqueHandle`).
 */
export async function upsertGithubUser(gh: {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
}): Promise<SessionUser> {
  const [existing] = await db.select().from(users).where(eq(users.githubId, gh.id)).limit(1)
  if (existing) return toSession(existing)

  for (let attempt = 0; attempt < 2; attempt++) {
    const handle = await uniqueHandle(attempt === 0 ? [gh.login, gh.name] : ['github-user'])
    try {
      const [u] = await db
        .insert(users)
        .values({ githubId: gh.id, handle, name: gh.name, avatarUrl: gh.avatar_url })
        .returning()
      return toSession(u)
    } catch (e) {
      // Гонка: параллельный вход тем же GitHub-аккаунтом или занятый handle.
      const [raced] = await db.select().from(users).where(eq(users.githubId, gh.id)).limit(1)
      if (raced) return toSession(raced)
      if (attempt === 1) throw e
    }
  }
  throw new Error('unreachable')
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
 * Вход через Яндекс/VK/Telegram: находим по внешнему id или создаём. handle
 * генерим сами (у провайдера может не быть логина) и дальше НЕ синхронизируем.
 */
export async function upsertOauthUser(provider: 'yandex' | 'vk' | 'telegram', p: OauthProfile): Promise<SessionUser> {
  const byExternalId =
    provider === 'yandex'
      ? eq(users.yandexId, String(p.externalId))
      : provider === 'vk'
        ? eq(users.vkId, Number(p.externalId))
        : eq(users.telegramId, Number(p.externalId))
  const [existing] = await db.select().from(users).where(byExternalId).limit(1)
  if (existing) return toSession(existing)

  const idValue =
    provider === 'yandex'
      ? { yandexId: String(p.externalId) }
      : provider === 'vk'
        ? { vkId: Number(p.externalId) }
        : { telegramId: Number(p.externalId) }
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
