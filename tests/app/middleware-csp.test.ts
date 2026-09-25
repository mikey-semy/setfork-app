import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CSP_HEADER, NONCE_HEADER } from '@/shared/security/csp'

/**
 * NONCE НА КАЖДЫЙ ОТВЕТ И ТОЛЬКО ОТ НАС.
 *
 * Next.js доставляет изменённые заголовки запроса рендеру парами
 * `x-middleware-request-<имя>` — по ним и проверяем, что увидит layout.
 */
vi.mock('@/shared/settings/maintenance', () => ({ maintenanceEnabled: async () => false }))
const { middleware } = await import('@/middleware')

const call = (path: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(new Request(`https://setfork.test${path}`, { headers: { 'accept-language': 'en', ...headers } })))
const toRender = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)
const nonceIn = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1]

describe('политика скриптов в middleware', () => {
  // Оба выхода middleware: обычный проход и переписывание (языковой префикс).
  it.each(['/miki/list', '/ru/miki/list'])('%s: один nonce в ответе, в политике для Next и в x-nonce для layout', async (path) => {
    const res = await call(path)
    const nonce = nonceIn(res.headers.get(CSP_HEADER))
    expect(nonce).toBeTruthy()
    expect(nonceIn(toRender(res, CSP_HEADER.toLowerCase()))).toBe(nonce)
    expect(toRender(res, NONCE_HEADER)).toBe(nonce)
  })

  it('каждый ответ — свой nonce', async () => {
    const a = nonceIn((await call('/miki/list')).headers.get(CSP_HEADER))
    const b = nonceIn((await call('/miki/list')).headers.get(CSP_HEADER))
    expect(a).not.toBe(b)
  })

  it('⚠️ nonce, присланный клиентом, не доходит до рендера', async () => {
    const res = await call('/miki/list', { [NONCE_HEADER]: 'attacker', [CSP_HEADER]: "script-src 'nonce-attacker'" })
    expect(toRender(res, NONCE_HEADER)).not.toBe('attacker')
    expect(toRender(res, CSP_HEADER.toLowerCase())).not.toContain('attacker')
  })
})
