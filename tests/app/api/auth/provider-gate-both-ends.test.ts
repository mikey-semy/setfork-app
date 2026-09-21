import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ВЫКЛЮЧЕННЫЙ ПРОВАЙДЕР ВЫКЛЮЧЕН НА ОБОИХ КОНЦАХ — И НА СТАРТЕ, И НА ВОЗВРАТЕ.
 *
 * `AUTH_DISABLED_PROVIDERS` выключает вход через провайдера; штатный повод — ключи
 * приложения утекли. Стартовый маршрут перестаёт пускать сразу, а `callback` у Яндекса
 * и VK и поллинг Telegram гейта не имели вовсе: у всех, кто ушёл к провайдеру в
 * последние десять минут, кука состояния ещё жива, и их возврат доводил вход до конца
 * тем же секретом из env — то есть «выключенный» провайдер держался на побочном
 * эффекте, на истечении куки.
 *
 * ⚠️ Правило написано и исполнено было ТОЛЬКО для GitHub — в его колбэке даже стоит
 * объяснение. Это третий за день случай корня «канон есть, зовут не все»: рядом с
 * исполненным правилом живут три места, где его не позвали.
 *
 * Тест на КЛАСС: перечень провайдеров, и каждый обязан отказать на возврате. Появится
 * четвёртый — добавится строкой, а не новым тестом.
 */

// Выключены ВСЕ: тест проверяет поведение выключенного, а не какой-то один провайдер.
process.env.AUTH_DISABLED_PROVIDERS = 'github,yandex,vk,telegram'
process.env.GITHUB_CLIENT_ID = 'gh-id'
process.env.YANDEX_CLIENT_ID = 'ya-id'
process.env.VK_CLIENT_ID = 'vk-id'
process.env.TELEGRAM_BOT_TOKEN = 'tg-token'
process.env.TELEGRAM_BOT_USERNAME = 'tg-bot'

const entered = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/features/auth/oauth-entry', () => ({
  enterWithIdentity: vi.fn(async () => {
    entered.calls++
    return new Response(null, { status: 302 })
  }),
}))
vi.mock('@/shared/auth/users', () => ({
  upsertOauthUser: vi.fn(async () => ({ id: 'u1', handle: 'someone' })),
  upsertGithubUser: vi.fn(async () => ({ id: 'u1', handle: 'someone' })),
}))
vi.mock('@/shared/auth/app-origin', () => ({ appOrigin: () => 'https://app.test' }))

// Кука состояния ЖИВА и совпадает с параметром: это и есть окно, в котором выключенный
// провайдер доводил вход до конца.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name.endsWith('_oauth_state') ? { value: 'state-1' } : { value: 'tg-token-1' }),
    delete: () => {},
    set: () => {},
  }),
}))

/** Сеть до провайдера не должна понадобиться вовсе: отказ обязан случиться раньше. */
const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
vi.stubGlobal('fetch', fetchSpy)

// Маршруты принимают NextRequest; в тесте достаточно обычного Request — обработчик
// читает из него только адрес, а куки берёт из подменённого `next/headers`.
type Route = { GET: (req: never) => Promise<Response> }
const asRoute = (m: unknown) => m as Route

const CALLBACKS: Array<[name: string, load: () => Promise<Route>]> = [
  ['github', async () => asRoute(await import('@/app/api/auth/github/callback/route'))],
  ['yandex', async () => asRoute(await import('@/app/api/auth/yandex/callback/route'))],
  ['vk', async () => asRoute(await import('@/app/api/auth/vk/callback/route'))],
]

beforeEach(() => {
  entered.calls = 0
  fetchSpy.mockClear()
})

describe('выключенный провайдер не доводит вход на возврате', () => {
  it.each(CALLBACKS)('%s: callback отвечает отказом и не создаёт вход', async (_name, load) => {
    const route = await load()
    const res = await route.GET(new Request('https://app.test/cb?code=abc&state=state-1') as never)

    expect(res.headers.get('location'), 'возврат обязан уводить на вход с причиной').toContain('e=oauth_off')
    expect(entered.calls, 'вход довёлся до конца через выключенного провайдера').toBe(0)
    expect(fetchSpy, 'до провайдера ходили, хотя он выключен: секрет из env всё ещё в деле').not.toHaveBeenCalled()
  })

  // ⚠️ ОБРАТНАЯ СТОРОНА. Гейт, запирающий и включённого провайдера, ломает вход всем —
  // это дороже дыры, которую он закрывает: человек не понимает, почему его не пускают.
  // `oauthEnabled()` читает окружение на каждом вызове, поэтому включаем здесь же.
  it.each(CALLBACKS)('%s: ВКЛЮЧЁННЫЙ провайдер проходит гейт и идёт к провайдеру', async (_name, load) => {
    const saved = process.env.AUTH_DISABLED_PROVIDERS
    process.env.AUTH_DISABLED_PROVIDERS = ''
    try {
      const route = await load()
      const res = await route.GET(new Request('https://app.test/cb?code=abc&state=state-1') as never)
      expect(res.headers.get('location'), 'включённый провайдер получил отказ гейта').not.toContain('e=oauth_off')
    } finally {
      process.env.AUTH_DISABLED_PROVIDERS = saved
    }
  })

  it('telegram: поллинг не завершает вход выключенного провайдера', async () => {
    // Поллинг — POST, а не GET: первая редакция теста звала несуществующий метод и
    // краснела не тем местом.
    const route = (await import('@/app/api/auth/telegram/poll/route')) as unknown as {
      POST: (req: Request) => Promise<Response>
    }
    const res = await route.POST(new Request('https://app.test/api/auth/telegram/poll', { method: 'POST' }))
    const body = (await res.json()) as { error?: string }

    expect(body.error, 'поллинг обязан отказать, а не ждать подтверждения').toBeTruthy()
    expect(entered.calls, 'вход довёлся до конца через выключенный Telegram').toBe(0)
  })
})
