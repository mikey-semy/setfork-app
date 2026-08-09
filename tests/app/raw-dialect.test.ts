// Поверхность `/raw` под тем же правилом, что и генератор: обёртка диалекта не
// переводит авторские команды, поэтому `?lang=py` на списке с шелловыми командами
// получает отказ, а не Python-скрипт с чужим телом внутри.
//
// Без базы: guard и язык замоканы, всё остальное — настоящий роут. Карточки 010/018
// реестра ровно про то, что у этой поверхности не было ни одного теста.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DIALECT_CANNOT_CARRY } from '@/features/library/export'
import { AUTHORED_DIALECT, dialectSpec } from '@/core/domain/script-dialect'

const CMD = 'export FOO=bar && echo "$FOO"'
// Происхождение скрипта роут берёт из КОНФИГУРАЦИИ, а не из адреса запроса (на проде
// `req.url` собран из адреса привязки сервера) — значит и тест задаёт его конфигурацией.
const ORIGIN = 'https://setfork.test'
process.env.APP_URL = ORIGIN

const h = vi.hoisted(() => ({ detail: null as unknown }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))
vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => null }))
vi.mock('@/features/library/guard', () => ({
  requireViewableDetail: async () => h.detail,
  requireViewableDetailFor: async () => h.detail,
}))

const { GET } = await import('@/app/[handle]/[slug]/raw/route')

const HANDLE = 'probe'
const SLUG = 'probe-list'
const params = Promise.resolve({ handle: HANDLE, slug: SLUG })
const call = (query = '') => GET(new Request(`https://setfork.test/${HANDLE}/${SLUG}/raw${query}`), { params })

/** Список из одного шага; `command` задаётся тестом. */
const detailWith = (command: string, extra: Record<string, unknown> = {}) => ({
  tpl: {
    title: { en: 'Probe list' },
    desc: { en: '' },
    tags: [],
    ordered: true,
    currentVersion: 1,
    visibility: 'public',
    status: 'published',
    moderation: 'active',
    owner: { handle: HANDLE },
    slug: SLUG,
    updatedAt: new Date('2026-08-09T00:00:00Z'),
  },
  currentVersion: { version: 1 },
  steps: [
    {
      n: 1,
      blockId: 'b1',
      title: { en: 'Set the variable' },
      desc: { en: '' },
      command,
      level: 'required',
      why: { en: '' },
      subtasks: [],
      refs: [],
      ...extra,
    },
  ],
})

beforeEach(() => {
  h.detail = detailWith(CMD)
})

describe('GET /{handle}/{slug}/raw — диалект и авторские команды', () => {
  it(`${AUTHORED_DIALECT}: команда приезжает исполняемой`, async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.text()).toContain(CMD)
  })

  for (const dialect of ['py', 'ps1'] as const) {
    it(`${dialect}: отказ 406 с причиной в заголовке, а не чужой скрипт`, async () => {
      const res = await call(`?lang=${dialect}`)
      expect(res.status).toBe(406)
      expect(res.headers.get('SF-Reason')).toBe(DIALECT_CANNOT_CARRY)
      expect(res.headers.get('Cache-Control')).toContain('no-store')
    })

    it(`${dialect}: в теле отказа нет авторской команды и есть рабочая замена`, async () => {
      const body = await (await call(`?lang=${dialect}`)).text()
      expect(body).not.toContain(CMD)
      expect(body).toContain(dialectSpec(AUTHORED_DIALECT).run(`${ORIGIN}/${HANDLE}/${SLUG}/raw`))
    })

    it(`${dialect}: список без исполняемых команд отдаётся как прежде`, async () => {
      h.detail = detailWith('')
      const res = await call(`?lang=${dialect}`)
      expect(res.status).toBe(200)
    })
  }

  it('py: предложенная замена сохраняет выборку пунктов', async () => {
    const body = await (await call('?lang=py&bid=b1')).text()
    expect(body).toContain(`https://setfork.test/${HANDLE}/${SLUG}/raw?bid=b1`)
  })
})
