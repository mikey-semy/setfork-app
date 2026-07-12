import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_PAGE_URL_MAX,
  parseFeedback,
} from '@/features/feedback/validate'

const okBody = 'Достаточно длинный текст фидбека.'

describe('parseFeedback', () => {
  it('принимает валидный минимум и нормализует категорию', () => {
    const r = parseFeedback({ body: okBody, category: 'bug' })
    expect(r).toMatchObject({ ok: true, category: 'bug', body: okBody, email: '', pageUrl: '' })
  })

  it('неизвестная/отсутствующая категория превращается в other', () => {
    expect(parseFeedback({ body: okBody, category: 'hack' })).toMatchObject({ ok: true, category: 'other' })
    expect(parseFeedback({ body: okBody })).toMatchObject({ ok: true, category: 'other' })
    expect(parseFeedback({ body: okBody, category: 42 })).toMatchObject({ ok: true, category: 'other' })
  })

  it('honeypot: непустое website = spam', () => {
    expect(parseFeedback({ body: okBody, website: 'http://spam.example' })).toEqual({ ok: false, error: 'spam' })
    // пробельный honeypot — не спам (автозаполнение браузера так не делает, но на всякий)
    expect(parseFeedback({ body: okBody, website: '   ' })).toMatchObject({ ok: true })
  })

  it('короткое/длинное тело отклоняется, границы включительно', () => {
    expect(parseFeedback({ body: 'коротко' })).toEqual({ ok: false, error: 'body_short' })
    expect(parseFeedback({ body: 'я'.repeat(10) })).toMatchObject({ ok: true })
    expect(parseFeedback({ body: 'я'.repeat(FEEDBACK_BODY_MAX) })).toMatchObject({ ok: true })
    expect(parseFeedback({ body: 'я'.repeat(FEEDBACK_BODY_MAX + 1) })).toEqual({ ok: false, error: 'body_long' })
  })

  it('тело: CRLF нормализуется, края обрезаются', () => {
    const r = parseFeedback({ body: '  первая\r\nвторая строка  ' })
    expect(r).toMatchObject({ ok: true, body: 'первая\nвторая строка' })
  })

  it('email: пустой ок, валидный ок, мусор — bad_email', () => {
    expect(parseFeedback({ body: okBody, email: '' })).toMatchObject({ ok: true, email: '' })
    expect(parseFeedback({ body: okBody, email: ' user@example.com ' })).toMatchObject({
      ok: true,
      email: 'user@example.com',
    })
    expect(parseFeedback({ body: okBody, email: 'not-an-email' })).toEqual({ ok: false, error: 'bad_email' })
    expect(parseFeedback({ body: okBody, email: 'a@b' })).toEqual({ ok: false, error: 'bad_email' })
    expect(parseFeedback({ body: okBody, email: `${'x'.repeat(200)}@example.com` })).toEqual({
      ok: false,
      error: 'bad_email',
    })
  })

  it('pageUrl: режет управляющие символы и длину, не-строки игнорирует', () => {
    const dirty = `/lists${String.fromCharCode(1)}?a=1${'x'.repeat(600)}`
    const r = parseFeedback({ body: okBody, pageUrl: dirty })
    if (!r.ok) throw new Error('expected ok')
    expect(r.pageUrl.startsWith('/lists?a=1')).toBe(true)
    expect(r.pageUrl.length).toBeLessThanOrEqual(FEEDBACK_PAGE_URL_MAX)
    expect(parseFeedback({ body: okBody, pageUrl: { evil: true } })).toMatchObject({ ok: true, pageUrl: '' })
  })
})
