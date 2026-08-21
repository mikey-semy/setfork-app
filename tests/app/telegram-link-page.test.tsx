import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ПРИВЯЗКА ТЕЛЕГРАМА ИЗ НАСТРОЕК ВООБЩЕ НЕ РАБОТАЛА.
 *
 * Маршрут привязки ставит намерение и ведёт на шаг с ботом, а шаг отправлял ЛЮБУЮ открытую
 * сессию на главную — то есть бот-экран не показывался ни разу, и привязать телеграм было
 * нельзя. Замечание авто-ревью на #782 (P1): смержено непрочитанным, дожило до этого разбора.
 *
 * Проверяется ровно развилка: вошедшего без намерения по-прежнему уводим (иначе страница
 * входа становится доступна тому, кто уже вошёл), а вошедшего С намерением — пускаем.
 */

const h = vi.hoisted(() => ({
  session: null as null | { userId: string; handle: string },
  intent: false,
  token: 'tok' as string | undefined,
  redirected: [] as string[],
}))

vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/features/auth/oauth-entry', () => ({ hasLinkIntent: async () => h.intent }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'tg_login' && h.token ? { value: h.token } : undefined) }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    h.redirected.push(to)
    throw new Error('REDIRECT')
  },
}))

const { default: TelegramLoginPage } = await import('@/app/login/telegram/page')

/** Отрисовку не проверяем — только развилку: увели или пустили. */
const open = async () => {
  h.redirected = []
  try {
    await TelegramLoginPage()
    return 'показана'
  } catch {
    return h.redirected[0] ?? 'ошибка'
  }
}

beforeEach(() => {
  h.session = null
  h.intent = false
  h.token = 'tok'
  process.env.TELEGRAM_BOT_TOKEN ||= 'x'
  process.env.TELEGRAM_BOT_USERNAME ||= 'bot'
  delete process.env.AUTH_DISABLED_PROVIDERS
})

describe('шаг входа через телеграм', () => {
  it('гостю показывается', async () => {
    expect(await open()).toBe('показана')
  })

  it('вошедшему БЕЗ намерения привязать — на главную', async () => {
    h.session = { userId: 'u1', handle: 'mike' }
    expect(await open()).toBe('/')
  })

  it('вошедшему С намерением привязать — показывается', async () => {
    h.session = { userId: 'u1', handle: 'mike' }
    h.intent = true
    expect(await open()).toBe('показана')
  })

  it('без токена — обратно на вход, даже с намерением', async () => {
    h.session = { userId: 'u1', handle: 'mike' }
    h.intent = true
    h.token = undefined
    expect(await open()).toBe('/login')
  })
})
