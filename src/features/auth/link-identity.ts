import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { IDENTITIES, linkedProviders, signInMethodsCount } from '@/shared/auth/identities'
import type { OauthProvider } from '@/shared/auth/oauth'
import { recordAudit } from '@/shared/audit'

/**
 * ПРИВЯЗКА СПОСОБА ВХОДА к УЖЕ ВОШЕДШЕМУ аккаунту.
 *
 * Зачем: вход новым провайдером заводил нового пользователя — по одному аккаунту на
 * способ входа. Отсюда и берутся «расплодившиеся» учётки: тот же человек, вошедший
 * вчера Яндексом, а сегодня GitHub, оказывался двумя разными авторами.
 *
 * Форма взята у Gitea (`ACCOUNT_LINKING=login`): идентичность привязывается к аккаунту,
 * ВЛАДЕНИЕ которым доказано входом, а не совпадением адреса почты. Их же документация
 * предупреждает, что автопривязка по email (`auto`) выдаёт доступ всякому, кто предъявит
 * тот же адрес; у нас поэтому и стоит «email занят → не пишем» при регистрации.
 *
 * Два правила, оба про необратимое:
 *  - чужую идентичность не забираем: она уже чей-то единственный вход;
 *  - последний свой способ входа не отвязываем — это дверь снаружи.
 */

export type LinkOutcome = 'linked' | 'already-yours' | 'taken'

/**
 * Привязать идентичность провайдера к пользователю.
 *
 * Возвращает исход, а не бросает: вызывающий (OAuth-callback) обязан довести человека
 * до понятного экрана, а не до пятисотой.
 */
export async function linkIdentity(userId: string, provider: OauthProvider, externalId: string | number): Promise<LinkOutcome> {
  const spec = IDENTITIES[provider]
  const [owner] = await db.select({ id: users.id }).from(users).where(spec.where(externalId)).limit(1)
  if (owner) return owner.id === userId ? 'already-yours' : 'taken'

  // Условие на текущего владельца колонки внутри UPDATE: между чтением выше и записью
  // тот же аккаунт провайдера мог занять параллельный вход. Уникальный индекс это
  // поймает, но вернёт ошибку БД вместо ответа, который можно показать человеку.
  const done = await db
    .update(users)
    .set(spec.value(externalId))
    .where(and(eq(users.id, userId), eq(users.deleted, false)))
    .returning({ id: users.id })
    .catch(() => [])
  if (!done.length) return 'taken'

  await recordAudit('auth.identity-link', { actorId: userId, targetType: 'user', targetId: userId, meta: { provider } })
  return 'linked'
}

export type UnlinkOutcome = 'unlinked' | 'not-linked' | 'last-method'

/** Отвязать идентичность. Последний способ входа отвязать нельзя. */
export async function unlinkIdentity(userId: string, provider: OauthProvider): Promise<UnlinkOutcome> {
  const spec = IDENTITIES[provider]
  const [u] = await db
    .select({ githubId: users.githubId, yandexId: users.yandexId, vkId: users.vkId, telegramId: users.telegramId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u || !linkedProviders(u).includes(provider)) return 'not-linked'
  if ((await signInMethodsCount(userId)) <= 1) return 'last-method'

  await db.update(users).set(spec.value(null)).where(eq(users.id, userId))
  await recordAudit('auth.identity-unlink', { actorId: userId, targetType: 'user', targetId: userId, meta: { provider } })
  return 'unlinked'
}

/**
 * Есть ли у ДРУГОГО пользователя такая идентичность — вопрос экрана входа: показывать
 * ли «этот аккаунт уже привязан к другому профилю» вместо молчаливого создания третьего.
 */
export async function identityTakenByOther(userId: string, provider: OauthProvider, externalId: string | number): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(IDENTITIES[provider].where(externalId), ne(users.id, userId)))
    .limit(1)
  return !!row
}
