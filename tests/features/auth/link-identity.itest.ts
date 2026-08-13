import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// ПРИВЯЗКА СПОСОБОВ ВХОДА на реальной БД. Здесь проверяется не UI, а два правила, каждое
// из которых стоит доступа к чужому или своему аккаунту: чужую идентичность нельзя
// забрать, а последний свой вход нельзя отвязать. Форма — Gitea ACCOUNT_LINKING=login:
// привязываем к аккаунту, владение которым доказано входом, а не совпадением почты.

const { db, passkeys, users } = await import('@/shared/db')
const { linkIdentity, unlinkIdentity } = await import('@/features/auth/link-identity')
const { linkedProviders, signInMethodsCount } = await import('@/shared/auth/identities')

const mkUser = async (handle: string, over: Partial<typeof users.$inferInsert> = {}) => {
  const [u] = await db.insert(users).values({ handle, ...over }).returning()
  return u
}

const rowOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]

beforeEach(async () => {
  await resetTables([passkeys, users])
})
afterAll(async () => {
  await resetTables([passkeys, users])
})

describe('привязка способа входа', () => {
  it('свободная идентичность привязывается к текущему аккаунту', async () => {
    const u = await mkUser('linker', { yandexId: 'ya-1' })

    expect(await linkIdentity(u.id, 'github', 42)).toBe('linked')

    expect((await rowOf(u.id)).githubId).toBe(42)
    expect(linkedProviders(await rowOf(u.id)).sort()).toEqual(['github', 'yandex'])
  })

  it('своя же идентичность повторно — не ошибка, но и не действие', async () => {
    const u = await mkUser('linker', { githubId: 7 })

    expect(await linkIdentity(u.id, 'github', 7)).toBe('already-yours')
  })

  // Самое важное правило: идентичность — это ключ от аккаунта. Позволить забрать чужую
  // значило бы отдать вход в чужой профиль тому, кто первым нажал «привязать».
  it('чужую идентичность не забираем', async () => {
    const mine = await mkUser('mine', { yandexId: 'ya-mine' })
    const other = await mkUser('other', { githubId: 99 })

    expect(await linkIdentity(mine.id, 'github', 99)).toBe('taken')

    expect((await rowOf(mine.id)).githubId).toBeNull()
    expect((await rowOf(other.id)).githubId).toBe(99)
  })

  it('строковый id Яндекса и числовой id VK не путаются', async () => {
    const u = await mkUser('mixed', { githubId: 1 })

    expect(await linkIdentity(u.id, 'yandex', '100500')).toBe('linked')
    expect(await linkIdentity(u.id, 'vk', 100500)).toBe('linked')

    const row = await rowOf(u.id)
    expect(row.yandexId).toBe('100500')
    expect(row.vkId).toBe(100500)
  })
})

describe('отвязка способа входа', () => {
  it('отвязывается, когда есть чем войти ещё', async () => {
    const u = await mkUser('two-ways', { githubId: 5, yandexId: 'ya-5' })

    expect(await unlinkIdentity(u.id, 'github')).toBe('unlinked')

    expect((await rowOf(u.id)).githubId).toBeNull()
  })

  // Отвязать последний вход — это закрыть себе дверь снаружи: вернуть доступ сможет
  // только владелец инстанса руками в базе.
  it('последний способ входа отвязать нельзя', async () => {
    const u = await mkUser('only-one', { githubId: 5 })

    expect(await unlinkIdentity(u.id, 'github')).toBe('last-method')

    expect((await rowOf(u.id)).githubId).toBe(5)
  })

  it('пароль тоже считается входом — с ним отвязка последнего провайдера разрешена', async () => {
    const u = await mkUser('with-password', { githubId: 5, passwordHash: 'scrypt$fake' })

    expect(await signInMethodsCount(u.id)).toBe(2)
    expect(await unlinkIdentity(u.id, 'github')).toBe('unlinked')
  })

  it('непривязанный способ отвязать нечем', async () => {
    const u = await mkUser('no-vk', { githubId: 5, yandexId: 'ya-5' })

    expect(await unlinkIdentity(u.id, 'vk')).toBe('not-linked')
  })

  // Две вкладки, повторная отправка формы, второй инстанс — оба запроса видели «входов
  // два» и оба чистили свою колонку. Правило соблюдалось дважды, а дверей не оставалось.
  it('две одновременные отвязки не оставляют аккаунт без входа', async () => {
    const u = await mkUser('race', { githubId: 5, yandexId: 'ya-5' })

    const [a, b] = await Promise.all([unlinkIdentity(u.id, 'github'), unlinkIdentity(u.id, 'yandex')])

    expect([a, b].sort()).toEqual(['last-method', 'unlinked'])
    const row = await rowOf(u.id)
    expect(linkedProviders(row)).toHaveLength(1)
  })
})

describe('последняя дверь: правило одно на все способы входа', () => {
  const addPasskey = async (userId: string, name: string) => {
    const [row] = await db
      .insert(passkeys)
      .values({ userId, credentialId: `cred-${name}`, publicKey: 'base64url-key', name })
      .returning({ id: passkeys.id })
    return row.id
  }

  // Обход, который нашло авто-ревью: passkey засчитывается при отвязке провайдера, а
  // удаляется без всякой проверки. Два шага — и войти нечем.
  it('passkey нельзя удалить, если он остался единственным входом', async () => {
    const u = await mkUser('passkey-only', { githubId: 5 })
    const keyId = await addPasskey(u.id, 'единственный')

    expect(await unlinkIdentity(u.id, 'github')).toBe('unlinked')

    const { wouldLoseLastMethod } = await import('@/shared/auth/identities')
    expect(await wouldLoseLastMethod(u.id, { passkeyId: keyId })).toBe(true)
  })

  it('пока входов больше одного, закрыть любой можно', async () => {
    const u = await mkUser('two-doors', { githubId: 5 })
    const keyId = await addPasskey(u.id, 'второй')

    const { wouldLoseLastMethod } = await import('@/shared/auth/identities')
    expect(await wouldLoseLastMethod(u.id, { passkeyId: keyId })).toBe(false)
    expect(await wouldLoseLastMethod(u.id, { provider: 'github' })).toBe(false)
  })
})
