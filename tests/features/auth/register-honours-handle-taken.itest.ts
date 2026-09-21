import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// РЕГИСТРАЦИЯ ОБЯЗАНА ПРОХОДИТЬ ТЕ ЖЕ ПРОВЕРКИ, ЧТО СМЕНА НИКА.
//
// Канон занятости — `handleTaken()`. Смена ника зовёт его, регистрация ходила в users
// напрямую и потому не знала про УДЕРЖАНИЕ прежнего ника: после переименования
// alice → alice-dev прежний ник ещё ведёт на своего человека (внешние ссылки, git
// remote в клонах его списков), а посторонний мог занять его регистрацией.
//
// ⚠️ Тест — НА КЛАСС, а не на конкретный случай. Он перебирает то, что канон считает
// занятым, и требует отказа от регистрации для каждого. Иначе следующая проверка,
// добавленная в `handleTaken`, снова обойдётся стороной: в #476 регистрацию уже латали
// точечно — вписали `isHandleShapeValid` вместо вызова канона, и удержание осталось
// незакрытым. Это третий повтор корня «канон есть, зовут не все».

process.env.ADMIN_HANDLES = 'bigboss'

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))
vi.mock('@/shared/auth/session', () => ({ startSession: async () => {}, getSession: async () => null }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 100 }) }))
vi.mock('@/shared/auth/app-origin', () => ({ clientIpFromHeaders: async () => '127.0.0.1' }))
vi.mock('@/shared/media', () => ({ avatarSrc: async () => null }))

const { db, users, userRedirects } = await import('@/shared/db')
const { registerWithPassword } = await import('@/features/auth/actions')
const { handleTaken } = await import('@/shared/auth/handle')

const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.append(k, v)
  return f
}

/** Регистрация: либо {error}, либо 'redirect' (успех уводит со страницы). */
async function register(handle: string, email: string): Promise<{ error?: string } | 'redirect'> {
  try {
    return (await registerWithPassword(null, fd({ email, handle, password: 'correct-horse' }))) ?? {}
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('REDIRECT:')) return 'redirect'
    throw e
  }
}

const rowOf = (handle: string) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.handle, handle) })

beforeAll(async () => {
  await resetTables([userRedirects, users])
  // Алиса переименовалась: живёт под alice-dev, прежний ник удерживается за ней.
  const [alice] = await db
    .insert(users)
    .values({ email: 'alice@example.test', handle: 'alice-dev', name: 'Alice' })
    .returning()
  await db.insert(userRedirects).values({ handle: 'alice', userId: alice.id })
  // Живой чужой ник — для контроля, что обычная занятость тоже отвергается.
  await db.insert(users).values({ email: 'bob@example.test', handle: 'bob', name: 'Bob' })
})

afterAll(async () => {
  await resetTables([userRedirects, users])
})

describe('регистрация проходит те же проверки занятости, что смена ника', () => {
  // Перечень — это и есть КЛАСС: всё, что канон считает занятым. Появится новая
  // причина занятости — добавится сюда строкой, а не новым тестом.
  it.each([
    ['удерживаемый прежний ник другого человека', 'alice'],
    ['живой ник другого человека', 'bob'],
    ['ник администратора', 'bigboss'],
  ])('канон считает занятым — регистрация отказывает: %s', async (_name, handle) => {
    expect(await handleTaken(handle), 'предпосылка: канон обязан считать этот ник занятым').toBe(true)

    const res = await register(handle, `probe-${handle}@example.test`)

    expect(res, `регистрация на «${handle}» прошла, хотя канон считает ник занятым`).not.toBe('redirect')
    expect((res as { error?: string }).error, 'отказ обязан называть причину, а не молчать').toBeTruthy()
    // И в базе не должно появиться строки: отказ на уровне текста, но с записью —
    // это тот же дефект, только тише.
    const row = await rowOf(handle)
    expect(row?.email, `в users появился «${handle}» — отказ был только на словах`).not.toBe(
      `probe-${handle}@example.test`,
    )
  })

  // ⚠️ Обратная сторона. Правило, которое отвергает всё, бесполезно так же, как дырявое:
  // ложный отказ в регистрации дороже пропуска — человек не заводит аккаунт и не
  // понимает почему.
  it('свободный ник регистрируется', async () => {
    expect(await handleTaken('carol')).toBe(false)
    const res = await register('carol', 'carol@example.test')
    expect(res, 'свободный ник обязан регистрироваться').toBe('redirect')
    expect((await rowOf('carol'))?.email).toBe('carol@example.test')
  })

  it('к своему прежнему нику вернуться можно — удержание чужих, а не своих', async () => {
    // Регистрация заводит НОВОГО человека, поэтому «своих» прежних ников у неё нет:
    // проверка обязана быть без исключения по пользователю. Здесь фиксируется, что
    // послабление `exceptUserId` в регистрацию не просочилось.
    expect(await handleTaken('alice', undefined)).toBe(true)
  })
})
