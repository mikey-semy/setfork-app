import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { demoLoginEnabled, oauthEnabled, parseDisabledProviders } from '@/shared/auth/oauth'

const ENV_KEYS = [
  'GITHUB_CLIENT_ID',
  'YANDEX_CLIENT_ID',
  'VK_CLIENT_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'AUTH_DISABLED_PROVIDERS',
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('parseDisabledProviders', () => {
  it('пусто/undefined → пустой набор', () => {
    expect(parseDisabledProviders(undefined).size).toBe(0)
    expect(parseDisabledProviders('').size).toBe(0)
  })

  it('список с пробелами и регистром нормализуется', () => {
    const s = parseDisabledProviders(' GitHub , vk ')
    expect(s.has('github')).toBe(true)
    expect(s.has('vk')).toBe(true)
    expect(s.has('yandex')).toBe(false)
  })
})

describe('oauthEnabled', () => {
  it('без кредов все выключены', () => {
    expect(oauthEnabled()).toEqual({ github: false, yandex: false, vk: false, telegram: false })
  })

  it('провайдер включается кредами', () => {
    process.env.YANDEX_CLIENT_ID = 'x'
    process.env.VK_CLIENT_ID = 'y'
    expect(oauthEnabled()).toEqual({ github: false, yandex: true, vk: true, telegram: false })
  })

  it('telegram требует и токен бота, и username', () => {
    process.env.TELEGRAM_BOT_TOKEN = 't'
    expect(oauthEnabled().telegram).toBe(false)
    process.env.TELEGRAM_BOT_USERNAME = 'setforkbot'
    expect(oauthEnabled().telegram).toBe(true)
  })

  it('AUTH_DISABLED_PROVIDERS скрывает провайдера при живых кредах', () => {
    process.env.GITHUB_CLIENT_ID = 'gh'
    process.env.YANDEX_CLIENT_ID = 'ya'
    process.env.AUTH_DISABLED_PROVIDERS = 'github'
    expect(oauthEnabled()).toEqual({ github: false, yandex: true, vk: false, telegram: false })
  })
})

describe('demoLoginEnabled', () => {
  it('по умолчанию demo-вход разрешён (dev без OAuth-приложений)', () => {
    expect(demoLoginEnabled()).toBe(true)
  })

  it('выключается через AUTH_DISABLED_PROVIDERS вместе с остальными', () => {
    process.env.AUTH_DISABLED_PROVIDERS = 'github,telegram,demo'
    expect(demoLoginEnabled()).toBe(false)
  })

  it('регистр и пробелы не мешают (как у провайдеров)', () => {
    process.env.AUTH_DISABLED_PROVIDERS = ' Demo '
    expect(demoLoginEnabled()).toBe(false)
  })

  it('отключение других провайдеров demo не трогает', () => {
    process.env.AUTH_DISABLED_PROVIDERS = 'github'
    expect(demoLoginEnabled()).toBe(true)
  })
})
