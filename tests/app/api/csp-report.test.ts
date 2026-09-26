import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ПРИЁМНИК ОТЧЁТОВ CSP: всегда 204, мусор и слишком большое тело не пишутся, частые
 * отправители упираются в лимит. Подменена только запись в базу — разбор настоящий.
 */
const recorded: unknown[] = []
let dbDown = false
/** Что ответил лимит новых видов — запись зовёт его, только встретив новый вид. */
const allowed: boolean[] = []
vi.mock('@/features/security/csp-reports', async (orig) => ({
  ...(await orig<typeof import('@/features/security/csp-reports')>()),
  recordCspViolation: async (v: unknown, mayAdd: () => Promise<boolean>) => {
    if (dbDown) throw new Error('connection terminated')
    allowed.push(await mayAdd())
    recorded.push(v)
  },
}))
const { POST } = await import('@/app/api/csp-report/route')

let ip = 0
const send = (body: string, from = `10.0.0.${++ip}`) =>
  POST(new Request('https://setfork.test/api/csp-report', { method: 'POST', body, headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': from } }))
const report = JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline', 'document-uri': 'https://setfork.test/a' } })

beforeEach(() => {
  recorded.length = 0
  allowed.length = 0
  dbDown = false
})

describe('POST /api/csp-report', () => {
  it('отчёт принят и записан, ответ 204 без тела', async () => {
    const res = await send(report)
    expect(res.status).toBe(204)
    expect(recorded).toHaveLength(1)
  })

  it('не JSON — 204 и ничего не записано', async () => {
    expect((await send('not json')).status).toBe(204)
    expect(recorded).toHaveLength(0)
  })

  it('тело больше 64 КБ не разбирается — и без Content-Length (читается потоком с обрывом)', async () => {
    const big = JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline', pad: 'x'.repeat(70_000) } })
    expect((await send(big)).status).toBe(204)
    const chunked = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big))
        c.close()
      },
    })
    const res = await POST(new Request('https://setfork.test/api/csp-report', { method: 'POST', body: chunked, duplex: 'half', headers: { 'x-forwarded-for': '10.7.7.7' } } as RequestInit))
    expect(res.status).toBe(204)
    expect(recorded).toHaveLength(0)
  })

  it('⚠️ лимит считает ОТЧЁТЫ, а не запросы: пачки по 20 не умножают его', async () => {
    const batch = JSON.stringify(Array.from({ length: 20 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'script-src-elem', blockedURL: 'eval' } })))
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await send(batch, '10.8.8.8')).status)
    expect(recorded).toHaveLength(60)
    expect(codes[3]).toBe(429)
  })

  it('новых видов с одного адреса — не больше 20 в час', async () => {
    for (let i = 0; i < 21; i++) await send(report, '10.6.6.6')
    expect(allowed.slice(0, 20).every(Boolean)).toBe(true)
    expect(allowed[20]).toBe(false)
  })

  it('база недоступна — 204, а не 500', async () => {
    dbDown = true
    expect((await send(report)).status).toBe(204)
  })

  it('с одного адреса — не больше 60 отчётов в минуту', async () => {
    const codes: number[] = []
    for (let i = 0; i < 61; i++) codes.push((await send(report, '10.9.9.9')).status)
    expect(codes.slice(0, 60).every((c) => c === 204)).toBe(true)
    expect(codes[60]).toBe(429)
  })
})
