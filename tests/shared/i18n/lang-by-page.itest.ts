import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗРИТЕЛЬ БЕЗ ПРЕДПОЧТЕНИЯ ЯЗЫКА ПОЛУЧАЕТ СТРАНИЦУ СПИСКА НА ЯЗЫКЕ САМОГО СПИСКА (ADR-0030).
 *
 * Так приходит робот поисковика: ни куки, ни `Accept-Language`. Языка в адресе нет (ADR-0029),
 * и без этого шага русский список он видел бы английской страницей. Подменён только запрос
 * (`next/headers`); база и правило — настоящие.
 */
const req = vi.hoisted(() => ({ cookie: '' as string, accept: null as string | null, path: '/' }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'lang' && req.cookie ? { value: req.cookie } : undefined) }),
  headers: async () => {
    const h = new Headers({ 'x-request-path': req.path })
    if (req.accept !== null) h.set('accept-language', req.accept)
    return h
  },
}))

const { db, templates, users } = await import('@/shared/db')
const { REQUEST_PATH_HEADER } = await import('@/shared/request-path')
const { getLang } = await import('@/shared/i18n/server')

beforeAll(async () => {
  // Имя заголовка пути — из кода, а не угадано: подмена выше обязана ставить именно его.
  expect(REQUEST_PATH_HEADER).toBe('x-request-path')
  await resetTables([templates, users])
  const [o] = await db.insert(users).values({ handle: 'srclang' }).returning({ id: users.id })
  await db.insert(templates).values([
    { ownerId: o.id, slug: 'sup', title: { ru: 'Гороховый суп' }, lang: 'ru', status: 'published', visibility: 'public' },
    { ownerId: o.id, slug: 'secret', title: { ru: 'Тайный' }, lang: 'ru', status: 'published', visibility: 'private' },
    // До ADR-0030: язык не записан — угадывается по названию.
    { ownerId: o.id, slug: 'old', title: { ru: 'Старый' }, status: 'published', visibility: 'public' },
  ])
})

beforeEach(() => {
  req.cookie = ''
  req.accept = null
  req.path = '/'
})

describe('язык страницы для зрителя без предпочтения', () => {
  it('робот на публичном русском списке — ru, и на его подстраницах тоже', async () => {
    for (const path of ['/srclang/sup', '/srclang/sup/issues', '/srclang/sup/data.json']) {
      req.path = path
      expect(await getLang(), path).toBe('ru')
    }
  })

  it('язык не записан — угадывается по названию', async () => {
    req.path = '/srclang/old'
    expect(await getLang()).toBe('ru')
  })

  it('⚠️ приватный список языка не выдаёт: по умолчанию', async () => {
    req.path = '/srclang/secret'
    expect(await getLang()).toBe('en')
  })

  it('не страница списка — по умолчанию', async () => {
    for (const path of ['/', '/explore', '/srclang']) {
      req.path = path
      expect(await getLang(), path).toBe('en')
    }
  })

  it('человек назвал язык — его язык, а не списка', async () => {
    req.path = '/srclang/sup'
    req.accept = 'en-US,en;q=0.9'
    expect(await getLang()).toBe('en')
    req.accept = null
    req.cookie = 'en'
    expect(await getLang()).toBe('en')
  })
})
