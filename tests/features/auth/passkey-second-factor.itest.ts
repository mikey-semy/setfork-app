import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПРИ ВКЛЮЧЁННОЙ 2FA ПОЛНАЯ СЕССИЯ ВЫДАЁТСЯ ТОЛЬКО ПОСЛЕ ДВУХ ФАКТОРОВ — НА ЛЮБОМ ПУТИ.
 *
 * Путь пароля и путь OAuth ведут на шаг с кодом, а вход по passkey создавал сессию
 * сразу. Оправдание «passkey и есть два фактора» верно лишь тогда, когда аутентификатор
 * пользователя ДЕЙСТВИТЕЛЬНО проверил — PIN или биометрией. У нас
 * `userVerification: 'preferred'`, то есть он вправе ответить и без проверки; а сам ключ
 * синхронизируется связкой и лежит на всех устройствах человека, поэтому «владение»
 * здесь слабее, чем кажется.
 *
 * ⚠️ Поэтому развилка идёт по ФАКТУ (`userVerified` из ответа), а не по названию способа
 * и не по настройке: «всегда требовать код поверх ключа» — лишний шаг там, где человек
 * уже проверен, «никогда» — дыра там, где не проверен.
 *
 * Тест на КЛАСС: перечень сочетаний «проверен ли пользователь × включена ли 2FA», и для
 * каждого сказано, чем вход обязан кончиться. Новый способ входа добавится строкой.
 */

const started = vi.hoisted(() => ({ sessions: 0, pending: 0 }))

vi.mock('@/shared/auth/session', () => ({
  startSession: vi.fn(async () => {
    started.sessions++
  }),
  getSession: async () => null,
}))
vi.mock('./signed-cookies', () => ({ startPendingLogin: vi.fn(async () => {}) }))
vi.mock('@/features/auth/signed-cookies', () => ({
  startPendingLogin: vi.fn(async () => {
    started.pending++
  }),
}))
vi.mock('@/shared/media', () => ({ avatarSrc: async () => null }))
vi.mock('@/shared/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 100 }) }))
// ⚠️ Подмена модуля ЦЕЛИКОМ: неподменённый экспорт становится undefined, и вызов
// `appOrigin()` внутри `rpID()` бросал прямо в try — тест краснел с 'verify', будто
// ключ не прошёл проверку. Симптом указывал на проверку ключа, причина была в подмене.
vi.mock('@/shared/auth/app-origin', () => ({
  clientIpFromHeaders: async () => '127.0.0.1',
  appOrigin: () => 'https://app.test',
}))
// Кука испытания — НАСТОЯЩАЯ, подписанная тем же секретом: подменять чтение своего же
// правила значило бы проверять подмену, а не код. Значение кладётся в beforeEach.
process.env.AUTH_SECRET = 'test-secret-for-passkey-second-factor'
const challengeCookie = vi.hoisted(() => ({ value: '' }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'sf-pk-challenge' ? { value: challengeCookie.value } : undefined),
    delete: () => {},
    set: () => {},
  }),
}))

// ⚠️ Подменяется ТОЛЬКО внешняя библиотека WebAuthn — та часть, которую в тесте
// воспроизвести нечем (настоящий аутентификатор). Само правило («что делать при
// userVerified=false») остаётся нашим и проверяется по-настоящему.
const verified = vi.hoisted(() => ({ userVerified: true }))
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1, userVerified: verified.userVerified },
  }),
  generateAuthenticationOptions: async () => ({ challenge: 'challenge-1' }),
  generateRegistrationOptions: async () => ({ challenge: 'challenge-1' }),
  verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: {} }),
}))

const { SignJWT } = await import('jose')
const { db, users, passkeys } = await import('@/shared/db')
const { finishPasskeyLogin } = await import('@/features/auth/passkeys')

/** Живое испытание в том же виде, в каком его кладёт `beginPasskeyLogin`. */
async function freshChallenge(): Promise<string> {
  return new SignJWT({ challenge: 'challenge-1', purpose: 'auth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET))
}

async function seed(totpEnabled: boolean) {
  await resetTables([passkeys, users])
  const [u] = await db
    .insert(users)
    .values({ handle: 'pk-user', email: 'pk@example.test', totpEnabled })
    .returning({ id: users.id })
  await db.insert(passkeys).values({
    userId: u.id,
    credentialId: 'cred-1',
    publicKey: Buffer.from('key').toString('base64url'),
    counter: 0,
  })
}

beforeEach(async () => {
  started.sessions = 0
  started.pending = 0
  verified.userVerified = true
  challengeCookie.value = await freshChallenge()
})

const login = () => finishPasskeyLogin({ id: 'cred-1' } as never)

describe('второй фактор на пути passkey', () => {

  it('2FA включена, пользователь НЕ проверен ключом → сессии нет, ждём код', async () => {
    await seed(true)
    verified.userVerified = false

    const res = await login()

    expect(res, 'вход обязан продолжиться кодом, а не отказом').toEqual({ ok: true, totp: true })
    expect(started.sessions, 'выдана полная сессия в обход второго фактора').toBe(0)
    expect(started.pending, 'шаг с кодом не начат — человек застрянет').toBe(1)
  })

  it('2FA включена, пользователь ПРОВЕРЕН ключом → вход завершён сразу', async () => {
    await seed(true)
    verified.userVerified = true

    const res = await login()

    // Обратная сторона: требовать код поверх уже проверенного ключа — лишний шаг,
    // и человек с 2FA перестал бы пользоваться ключом вовсе.
    expect(res, 'проверенный ключ — это и есть два фактора').toEqual({ ok: true })
    expect(started.sessions).toBe(1)
    expect(started.pending).toBe(0)
  })

  it('2FA выключена, пользователь не проверен → вход завершён сразу', async () => {
    await seed(false)
    verified.userVerified = false

    const res = await login()

    expect(res, 'без 2FA ключ работает как прежде').toEqual({ ok: true })
    expect(started.sessions).toBe(1)
  })
})
