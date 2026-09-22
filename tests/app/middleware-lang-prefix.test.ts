import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * ЯЗЫКОВОЙ ПРЕФИКС НЕ ОТКЛЮЧАЕТ ОСТАЛЬНЫЕ ПРАВИЛА MIDDLEWARE.
 *
 * Первая редакция SEO-1 снимала префикс и СРАЗУ возвращала ответ. Всё, что middleware
 * делает ниже, для `/ru/…` не происходило:
 *  • в режиме ремонта страница отдавалась как обычно и ходила в базу — ровно тогда,
 *    когда режим существует, чтобы база молчала;
 *  • `/ru/alice/deploy.md` давал 404 — хотя llms.txt обещает агентам markdown по `.md`
 *    у ЛЮБОГО адреса списка;
 *  • старый адрес `/ru/explore?tab=topics` отдавался с 200 вместо перенаправления.
 * Проверено живым сервером на старом коде; две находки — авто-ревью, третья — по их
 * следу. Проверяем здесь ПАРАМИ: адрес с префиксом ведёт себя так же, как без него.
 */
let maintenance = false
vi.mock('@/shared/settings/maintenance', () => ({ maintenanceEnabled: async () => maintenance }))

const { middleware } = await import('@/middleware')

const call = (path: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(new Request(`https://setfork.test${path}`, { headers: { 'accept-language': 'en', ...headers } })))
const rewrittenTo = (res: Response) => {
  const u = res.headers.get('x-middleware-rewrite')
  return u ? new URL(u).pathname + new URL(u).search : null
}

beforeEach(() => {
  maintenance = false
})

describe('ремонт', () => {
  it.each(['/explore', '/ru/explore', '/en/explore'])('%s — заглушка 503', async (path) => {
    maintenance = true
    expect((await call(path)).status).toBe(503)
  })

  it('заглушка на языке адреса', async () => {
    maintenance = true
    expect(await (await call('/ru/explore')).text()).toContain('lang="ru"')
  })

  it('пробы отвечают и в ремонте, с префиксом тоже', async () => {
    maintenance = true
    expect((await call('/ru/healthz')).status).not.toBe(503)
  })
})

describe('markdown по `.md`', () => {
  it.each([
    ['/alice/deploy.md', '/alice/deploy/export?format=md'],
    ['/ru/alice/deploy.md', '/alice/deploy/export?format=md'],
  ])('%s → экспорт', async (path, target) => {
    const res = await call(path)
    expect(rewrittenTo(res)).toBe(target)
  })

  it('язык адреса доезжает до экспорта заголовком', async () => {
    const res = await call('/ru/alice/deploy.md')
    expect(res.headers.get('x-middleware-request-x-setfork-lang')).toBe('ru')
  })
})

describe('старые адреса «открытия»', () => {
  it.each([
    ['/explore?tab=topics', '/tags'],
    ['/ru/explore?tab=topics', '/ru/tags'],
    ['/en/explore?tab=trending&view=people', '/en/trending/people'],
  ])('%s → 308 %s', async (path, target) => {
    const res = await call(path)
    expect(res.status).toBe(308)
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe(target)
  })
})

describe('обычная страница с префиксом', () => {
  it('переписывается на маршрут без префикса', async () => {
    expect(rewrittenTo(await call('/ru/explore'))).toBe('/explore')
  })

  it('/rust — не префикс: пропускается как есть', async () => {
    const res = await call('/rust')
    expect(rewrittenTo(res)).toBeNull()
  })
})

describe('язык адреса приходит только от middleware', () => {
  it('подброшенный клиентом заголовок языка на адресе без префикса снимается', async () => {
    // Иначе `x-setfork-lang: ru` на `/miki/list` менял бы язык страницы и объявлял
    // каноном `/ru/miki/list` (находка авто-ревью).
    const res = await call('/miki/list', { 'x-setfork-lang': 'ru' })
    expect(res.headers.get('x-middleware-request-x-setfork-lang')).toBeNull()
    expect(res.headers.get('x-middleware-override-headers') ?? '').not.toContain('x-setfork-lang')
  })

  it('и на переписывании `.md` без префикса — тоже снимается', async () => {
    // Переписывание идёт мимо `pass`: снятие там одно этот путь не закрывало.
    const res = await call('/miki/list.md', { 'x-setfork-lang': 'ru' })
    expect(rewrittenTo(res)).toBe('/miki/list/export?format=md')
    expect(res.headers.get('x-middleware-request-x-setfork-lang')).toBeNull()
    expect(res.headers.get('x-middleware-override-headers') ?? '').not.toContain('x-setfork-lang')
  })

  it('на адресе с префиксом заголовок — из адреса, а не присланный', async () => {
    const res = await call('/en/miki/list', { 'x-setfork-lang': 'ru' })
    expect(res.headers.get('x-middleware-request-x-setfork-lang')).toBe('en')
  })
})
