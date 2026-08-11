import { beforeAll, describe, expect, it, vi } from 'vitest'

// Отписка живёт по токену из письма, без сессии — значит токен и есть право.
// Проверяем, что чужой токен этого права не даёт, а БД при отказе не трогается.

const updated: unknown[] = []
vi.mock('@/shared/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ prefs: { email: true, stars: false } }] }) }) }),
    update: () => ({
      set: (v: unknown) => {
        updated.push(v)
        return { where: async () => undefined }
      },
    }),
  },
  users: { id: 'id', notifyPrefs: 'notify_prefs' },
}))

// Модули грузим в beforeAll: env должен быть выставлен ДО импорта, а трансформ
// на холодном прогоне длиннее дефолтных 5 с таймаута самого теста.
let mod: typeof import('@/shared/email/unsubscribe')
let tokens: typeof import('@/shared/auth/tokens')

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-for-unsubscribe-tokens'
  process.env.APP_URL = 'https://setfork.com'
  mod = await import('@/shared/email/unsubscribe')
  tokens = await import('@/shared/auth/tokens')
}, 60_000)

describe('отписка от писем', () => {
  it('кладёт в ссылку токен, который читается обратно', async () => {
    const { unsubscribeUrl, UNSUBSCRIBE_PATH } = mod
    const { readToken } = tokens

    const url = await unsubscribeUrl('user-42')
    expect(url.startsWith(`https://setfork.com${UNSUBSCRIBE_PATH}?token=`)).toBe(true)

    const payload = await readToken(new URL(url).searchParams.get('token')!)
    expect(payload?.uid).toBe('user-42')
    expect(payload?.purpose).toBe('unsubscribe')
  })

  it('гасит только почту, остальные каналы не трогает', async () => {
    const { applyUnsubscribe, unsubscribeUrl } = mod
    updated.length = 0

    const url = await unsubscribeUrl('user-42')
    const ok = await applyUnsubscribe(new URL(url).searchParams.get('token')!)

    expect(ok).toBe(true)
    expect(updated).toEqual([{ notifyPrefs: { email: false, stars: false } }])
  })

  it('не принимает токен другого назначения и мусор', async () => {
    const { applyUnsubscribe } = mod
    const { signToken } = tokens
    updated.length = 0

    const reset = await signToken({ uid: 'user-42', purpose: 'reset-password' }, '1h')
    expect(await applyUnsubscribe(reset)).toBe(false)
    expect(await applyUnsubscribe('not-a-token')).toBe(false)
    expect(await applyUnsubscribe('')).toBe(false)
    expect(updated).toEqual([]) // до записи в БД дело не дошло
  })
})
