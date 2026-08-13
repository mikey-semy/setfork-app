import 'server-only'
import { eq, type SQL } from 'drizzle-orm'
import { db, passkeys, users } from '@/shared/db'
import type { OauthProvider } from './oauth'

/**
 * СПОСОБЫ ВХОДА как данные.
 *
 * Идентичность провайдера живёт своей колонкой в `users` (`github_id`, `yandex_id`,
 * `vk_id`, `telegram_id`), и соответствие «провайдер → колонка» до сих пор жило
 * тернарниками в каждом месте, где оно требовалось. Ветвление по значению на четыре
 * ветки — это таблица; здесь она и есть, единственная на приложение.
 *
 * Тип значения — тоже часть данных: у Яндекса id строковый (так в его API), у остальных
 * числовой. Поэтому условие и значение записаны явными выражениями: приведение типов
 * «на лету» пришлось бы гасить `as never`, а ошибиться тут стоит отказа во входе.
 */
interface IdentitySpec {
  /** Поле строки `users`, где лежит id пользователя у провайдера. */
  field: 'githubId' | 'yandexId' | 'vkId' | 'telegramId'
  /** Условие «эта идентичность» — для поиска владельца по внешнему id. */
  where: (externalId: string | number) => SQL
  /** Значение для записи/очистки колонки. */
  value: (externalId: string | number | null) => Record<string, string | number | null>
  /** Ключ словаря с названием способа входа. */
  labelKey: string
}

export const IDENTITIES: Record<OauthProvider, IdentitySpec> = {
  github: {
    field: 'githubId',
    where: (id) => eq(users.githubId, Number(id)),
    value: (id) => ({ githubId: id === null ? null : Number(id) }),
    labelKey: 'auth.methodGithub',
  },
  yandex: {
    field: 'yandexId',
    where: (id) => eq(users.yandexId, String(id)),
    value: (id) => ({ yandexId: id === null ? null : String(id) }),
    labelKey: 'auth.methodYandex',
  },
  vk: {
    field: 'vkId',
    where: (id) => eq(users.vkId, Number(id)),
    value: (id) => ({ vkId: id === null ? null : Number(id) }),
    labelKey: 'auth.methodVk',
  },
  telegram: {
    field: 'telegramId',
    where: (id) => eq(users.telegramId, Number(id)),
    value: (id) => ({ telegramId: id === null ? null : Number(id) }),
    labelKey: 'auth.methodTelegram',
  },
}

export const IDENTITY_PROVIDERS = Object.keys(IDENTITIES) as OauthProvider[]

type IdentityRow = Pick<typeof users.$inferSelect, 'githubId' | 'yandexId' | 'vkId' | 'telegramId'>

/** Какие провайдеры привязаны к строке пользователя. */
export function linkedProviders(u: IdentityRow): OauthProvider[] {
  return IDENTITY_PROVIDERS.filter((p) => u[IDENTITIES[p].field] !== null)
}

/**
 * Сколько у пользователя способов войти. Считаются ВСЕ двери: провайдеры, пароль и
 * passkey — иначе счёт врёт в опасную сторону.
 *
 * `exclude` описывает дверь, которую собираются закрыть: «сколько останется, если убрать
 * вот эту». Без параметра функция отвечала бы на другой вопрос, и каждый вызывающий
 * вычитал бы единицу сам — а ошибиться тут стоит потери доступа к аккаунту.
 */
export async function signInMethodsCount(
  userId: string,
  exclude?: { provider?: OauthProvider; passkeyId?: string; password?: boolean },
): Promise<number> {
  const [u] = await db
    .select({
      githubId: users.githubId,
      yandexId: users.yandexId,
      vkId: users.vkId,
      telegramId: users.telegramId,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u) return 0
  const keys = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))
  const providers = linkedProviders(u).filter((p) => p !== exclude?.provider).length
  const password = u.passwordHash && !exclude?.password ? 1 : 0
  return providers + password + keys.filter((k) => k.id !== exclude?.passkeyId).length
}

/**
 * ПОСЛЕДНЯЯ ДВЕРЬ. Правило одно на все способы входа: закрыть можно любой, кроме
 * единственного оставшегося — иначе человек запирает себя снаружи, и вернуть доступ
 * сможет только владелец инстанса руками в базе.
 *
 * Живёт здесь, а не в каждой фиче: проверка при отвязке провайдера ничего не стоит, если
 * удаление passkey рядом делает то же самое без проверки (находка авто-ревью на #782).
 */
export async function wouldLoseLastMethod(
  userId: string,
  closing: { provider?: OauthProvider; passkeyId?: string; password?: boolean },
): Promise<boolean> {
  return (await signInMethodsCount(userId, closing)) < 1
}
