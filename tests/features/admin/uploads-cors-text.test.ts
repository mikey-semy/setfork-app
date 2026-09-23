import { describe, expect, it } from 'vitest'
import { corsCheckText, corsSetupText } from '@/features/admin/uploads-cors-text'

/** Итог кнопок CORS в админке — причина словами, а не код. */
const origin = 'https://setfork.com'

describe('corsCheckText', () => {
  it('успех называет origin', () => {
    expect(corsCheckText({ ok: true, origin }, 'ru')).toEqual({ ok: true, text: expect.stringContaining(origin) })
  })

  it('TLS — про точку в имени бакета', () => {
    const r = corsCheckText({ ok: false, reason: 'tls', detail: 'ERR_TLS_CERT_ALTNAME_INVALID', origin }, 'ru')
    expect(r.ok).toBe(false)
    expect(r.text).toContain('с точкой')
    expect(r.text).toContain('ERR_TLS_CERT_ALTNAME_INVALID')
  })

  it('статус и отсутствие заголовка — разными причинами', () => {
    expect(corsCheckText({ ok: false, reason: 'status', status: 405, origin }, 'en').text).toContain('405')
    expect(corsCheckText({ ok: false, reason: 'no_allow_origin', status: 200, origin }, 'en').text).toContain('Access-Control-Allow-Origin')
  })
})

describe('corsSetupText', () => {
  it('успех и отказ хранилища с его текстом', () => {
    expect(corsSetupText({ ok: true, rules: 2 }, 'ru')).toEqual({ ok: true, text: expect.stringContaining('2') })
    expect(corsSetupText({ ok: false, reason: 'failed', detail: 'AccessDenied' }, 'ru').text).toContain('AccessDenied')
  })
})
