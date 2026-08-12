import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Отписка живёт по токену из письма, без сессии — значит токен и есть право.
// Проверяем, что чужой токен этого права не даёт, а БД при отказе не трогается.

const updated: unknown[] = []
/** Почта, которая «сейчас» стоит у аккаунта — тест её подменяет. */
let currentEmail = 'mike@example.org'

vi.mock('@/shared/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ prefs: { email: true, stars: false }, email: currentEmail }] }) }) }),
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
  beforeEach(() => {
    currentEmail = 'mike@example.org'
    updated.length = 0
  })

  it('кладёт в ссылку токен, который читается обратно', async () => {
    const { unsubscribeUrl, UNSUBSCRIBE_PATH } = mod
    const { readToken } = tokens

    const url = await unsubscribeUrl('user-42', 'mike@example.org')
    expect(url.startsWith(`https://setfork.com${UNSUBSCRIBE_PATH}?token=`)).toBe(true)

    const payload = await readToken(new URL(url).searchParams.get('token')!)
    expect(payload?.uid).toBe('user-42')
    expect(payload?.em).toBe('mike@example.org')
    expect(payload?.purpose).toBe('unsubscribe')
  })

  it('гасит только почту, остальные каналы не трогает', async () => {
    const { applyUnsubscribe, unsubscribeUrl } = mod

    const url = await unsubscribeUrl('user-42', 'MIKE@example.org')
    const ok = await applyUnsubscribe(new URL(url).searchParams.get('token')!)

    expect(ok).toBe(true)
    expect(updated).toEqual([{ notifyPrefs: { email: false, stars: false } }])
  })

  it('не отключает доставку на НОВЫЙ адрес по ссылке из старого письма', async () => {
    const { applyUnsubscribe, unsubscribeUrl } = mod

    const url = await unsubscribeUrl('user-42', 'old@example.org')
    currentEmail = 'new@example.org' // почту аккаунта сменили после отправки письма

    expect(await applyUnsubscribe(new URL(url).searchParams.get('token')!)).toBe(false)
    expect(updated).toEqual([])
  })

  it('не принимает токен другого назначения и мусор', async () => {
    const { applyUnsubscribe } = mod
    const { signToken } = tokens

    const reset = await signToken({ uid: 'user-42', em: 'mike@example.org', purpose: 'reset-password' }, '1h')
    expect(await applyUnsubscribe(reset)).toBe(false)
    expect(await applyUnsubscribe('not-a-token')).toBe(false)
    expect(await applyUnsubscribe('')).toBe(false)
    expect(updated).toEqual([]) // до записи в БД дело не дошло
  })
})
