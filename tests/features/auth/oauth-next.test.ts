import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚠️ ВОЗВРАТ ПОСЛЕ ВХОДА — ЭТО РАБОТОСПОСОБНОСТЬ ПОДКЛЮЧЕНИЯ, А НЕ УДОБСТВО.
 *
 * Путь многоступенчатый: `/oauth/authorize` → `/login?next=…` → внешний провайдер →
 * его callback → мы. Через провайдера параметры не проходят — он возвращает только
 * `code` и `state`, поэтому цель поездки кладётся в куку.
 *
 * Без этого человек, начавший подключать MCP и вошедший через GitHub, оказывался на
 * главной, и подключение молча не состоялось. Со второго раза работало — сессия уже
 * была, и экран согласия открывался сразу. Владелец прошёл ровно этот путь 02.09.2026:
 * «сначала просто зашлось на сайт, в итоге вышел и снова нажал, и там уже разрешение».
 */
const store = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
  }),
}))

const { peekNext, rememberNext, takeNext } = await import('@/features/auth/oauth-next')

describe('цель поездки через внешнего провайдера', () => {
  beforeEach(() => store.clear())

  it('внутренний путь запоминается и возвращается', async () => {
    await rememberNext('/oauth/authorize?client_id=x&scope=write')
    expect(await takeNext()).toBe('/oauth/authorize?client_id=x&scope=write')
  })

  it('цель снимается при первом же использовании', async () => {
    // Задержавшаяся цель увела бы человека в чужой поток при следующем обычном входе.
    await rememberNext('/oauth/authorize?x=1')
    await takeNext()
    expect(await takeNext()).toBe('')
  })

  it('подсмотреть можно, не сняв: страница входа предлагает повтор в тот же поток', async () => {
    await rememberNext('/oauth/authorize?x=1')
    expect(await peekNext()).toBe('/oauth/authorize?x=1')
    expect(await peekNext(), 'подсматривание не должно расходовать цель').toBe('/oauth/authorize?x=1')
  })

  it('внешний адрес не запоминается: это открытый редирект', async () => {
    await rememberNext('https://evil.example/steal')
    expect(await takeNext()).toBe('')
    await rememberNext('//evil.example/steal')
    expect(await takeNext(), 'протокол-относительный адрес тоже внешний').toBe('')
  })

  it('пустая цель стирает прежнюю, а не оставляет её висеть', async () => {
    await rememberNext('/oauth/authorize?x=1')
    await rememberNext(null)
    expect(await takeNext()).toBe('')
  })
})
