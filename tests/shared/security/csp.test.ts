import { describe, expect, it } from 'vitest'
import { CSP_HEADER, CSP_REPORT_PATH, cspNonce, cspPolicy } from '@/shared/security/csp'

/**
 * ПОЛИТИКА СКРИПТОВ: форма «строгого CSP» и режим отчётов.
 *
 * Next.js ищет nonce регуляркой `^'nonce-([A-Za-z0-9+/_-]+={0,2})'$` в `script-src`
 * (get-script-nonce-from-header). Nonce другого вида он молча пропустит — и его скрипты
 * уйдут без nonce, то есть ВСЕ попадут в нарушения. Поэтому проверяем тем же правилом.
 */
const NEXT_NONCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/

describe('nonce', () => {
  it('разбирается правилом Next.js и несёт 128 бит', () => {
    const n = cspNonce()
    expect(`'nonce-${n}'`).toMatch(NEXT_NONCE)
    expect(Buffer.from(n, 'base64')).toHaveLength(16)
  })

  it('каждый раз новый', () => {
    const seen = new Set(Array.from({ length: 100 }, cspNonce))
    expect(seen.size).toBe(100)
  })
})

describe('политика', () => {
  const p = cspPolicy('abc123==', false)
  const script = p.split('; ').find((d) => d.startsWith('script-src '))!

  it('скрипты — только по nonce и тем, кого они загрузили', () => {
    expect(script.split(' ')).toContain("'nonce-abc123=='")
    expect(script.split(' ')).toContain("'strict-dynamic'")
  })

  it("без 'unsafe-eval' в сборке, с ним — в разработке", () => {
    expect(p).not.toContain("'unsafe-eval'")
    expect(cspPolicy('abc123==', true)).toContain("'unsafe-eval'")
  })

  it('плагины и подмена base запрещены', () => {
    expect(p).toContain("object-src 'none'")
    expect(p).toContain("base-uri 'none'")
  })

  it('⚠️ отчёты — только report-uri: при report-to Chromium игнорирует report-uri и молчит', () => {
    expect(p).toContain(`report-uri ${CSP_REPORT_PATH}`)
    expect(p).not.toContain('report-to')
  })

  it('⚠️ пока — только отчёты: боевой заголовок включается после недели наблюдения', () => {
    expect(CSP_HEADER).toBe('Content-Security-Policy-Report-Only')
  })
})
