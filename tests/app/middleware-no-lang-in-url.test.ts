import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * ЯЗЫКА В АДРЕСЕ НЕТ: `/ru/…` И `/en/…` — ПОСТОЯННЫЙ ПЕРЕХОД НА АДРЕС БЕЗ ПРЕФИКСА (ADR-0029).
 *
 * С 22 по 25.09 у страниц были языковые адреса (#950, #959); они в индексе и во внешних
 * ссылках. Контракт:
 *  • 308 на тот же путь без префикса, с query — прежде любых других правил, в ремонте тоже;
 *  • 308, а не 301: вкладка, открытая до выкатки, шлёт серверное действие POST-ом на `/ru/…`;
 *  • язык прежнего адреса сохраняется кукой — только если расходится с тем, что выбралось бы;
 *  • `/rust`, `/ruslan/runbook` — не префикс (K40), их не трогаем;
 *  • всё остальное middleware (ремонт, `.md`, старые адреса «открытия») — как было.
 */
let maintenance = false
vi.mock('@/shared/settings/maintenance', () => ({ maintenanceEnabled: async () => maintenance }))

const { middleware } = await import('@/middleware')

const call = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  middleware(new NextRequest(new Request(`https://setfork.test${path}`, { method, headers: { 'accept-language': 'en', ...headers } })))
const location = (res: Response) => {
  const l = res.headers.get('location')
  return l ? new URL(l, 'https://setfork.test').pathname + new URL(l, 'https://setfork.test').search : null
}
const rewrittenTo = (res: Response) => {
  const u = res.headers.get('x-middleware-rewrite')
  return u ? new URL(u).pathname + new URL(u).search : null
}
const langCookie = (res: Response) => /(?:^|,\s*)lang=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null

beforeEach(() => {
  maintenance = false
})

describe('адрес с языковым префиксом', () => {
  it.each([
    ['/ru', '/'],
    ['/en/explore', '/explore'],
    ['/ru/miki/spisok', '/miki/spisok'],
    ['/ru/miki/spisok?v=3#x', '/miki/spisok?v=3'],
    ['/ru/alice/deploy.md', '/alice/deploy.md'],
    ['/en/explore?tab=topics', '/explore?tab=topics'],
  ])('%s → 308 %s', async (path, target) => {
    const res = await call(path)
    expect(res.status).toBe(308)
    expect(location(res)).toBe(target)
  })

  it('⚠️ POST тоже 308 — метод сохраняется, серверное действие не превращается в GET', async () => {
    expect((await call('/ru/miki/spisok', {}, 'POST')).status).toBe(308)
  })

  it('в ремонте — тоже переход, а не заглушка: правило адреса старше', async () => {
    maintenance = true
    expect((await call('/ru/explore')).status).toBe(308)
  })

  it('язык прежнего адреса остаётся кукой, если расходится с выбранным', async () => {
    expect(langCookie(await call('/ru/explore', { 'accept-language': 'en' }))).toBe('ru')
  })

  it('совпадает с выбранным — куку не пишем', async () => {
    expect(langCookie(await call('/ru/explore', { cookie: 'lang=ru' }))).toBeNull()
    expect(langCookie(await call('/en/explore', { 'accept-language': 'en' }))).toBeNull()
  })

  it.each(['/rust', '/ruslan/runbook', '/de/spisok'])('%s — не языковой префикс, перехода нет', async (path) => {
    const res = await call(path)
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
  })
})

describe('остальные правила — как были', () => {
  it('`.md` к адресу списка — экспорт', async () => {
    expect(rewrittenTo(await call('/alice/deploy.md'))).toBe('/alice/deploy/export?format=md')
  })

  it.each([
    ['/explore?tab=topics', '/tags'],
    ['/explore?tab=trending&view=people', '/trending/people'],
  ])('%s → 308 %s', async (path, target) => {
    const res = await call(path)
    expect(res.status).toBe(308)
    expect(location(res)).toBe(target)
  })

  it('ремонт — заглушка на языке куки', async () => {
    maintenance = true
    const res = await call('/explore', { cookie: 'lang=ru' })
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('lang="ru"')
  })

  it('пробы отвечают и в ремонте', async () => {
    maintenance = true
    expect((await call('/healthz')).status).not.toBe(503)
  })
})
