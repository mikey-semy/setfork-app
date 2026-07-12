import { describe, expect, it } from 'vitest'
import { REPORT_BODY_MAX, parseReport } from '@/features/reports/validate'

const tplId = '2b1f7c3a-9d4e-4f6a-8b2c-1e5d7a9c3f01'
const okBody = 'Список содержит нарушение правил.'

describe('parseReport', () => {
  it('принимает валидную жалобу', () => {
    const r = parseReport({ templateId: tplId, reason: 'copyright', body: okBody, email: 'a@b.co' })
    expect(r).toMatchObject({ ok: true, templateId: tplId, reason: 'copyright', email: 'a@b.co' })
  })

  it('honeypot: непустое website = spam', () => {
    expect(parseReport({ templateId: tplId, reason: 'spam', body: okBody, website: 'x' })).toEqual({
      ok: false,
      error: 'spam',
    })
  })

  it('невалидный templateId отклоняется до всего остального', () => {
    expect(parseReport({ templateId: 'not-a-uuid', reason: 'spam', body: okBody })).toEqual({
      ok: false,
      error: 'bad_template',
    })
    expect(parseReport({ reason: 'spam', body: okBody })).toEqual({ ok: false, error: 'bad_template' })
  })

  it('причина обязательна и не фолбэчится в other', () => {
    expect(parseReport({ templateId: tplId, reason: 'weird', body: okBody })).toEqual({
      ok: false,
      error: 'bad_reason',
    })
    expect(parseReport({ templateId: tplId, body: okBody })).toEqual({ ok: false, error: 'bad_reason' })
  })

  it('границы длины тела', () => {
    expect(parseReport({ templateId: tplId, reason: 'other', body: 'коротко' })).toEqual({
      ok: false,
      error: 'body_short',
    })
    expect(parseReport({ templateId: tplId, reason: 'other', body: 'я'.repeat(REPORT_BODY_MAX + 1) })).toEqual({
      ok: false,
      error: 'body_long',
    })
  })

  it('email: пустой ок, мусор — bad_email', () => {
    expect(parseReport({ templateId: tplId, reason: 'other', body: okBody })).toMatchObject({ ok: true, email: '' })
    expect(parseReport({ templateId: tplId, reason: 'other', body: okBody, email: 'nope' })).toEqual({
      ok: false,
      error: 'bad_email',
    })
  })
})
