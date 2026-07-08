import { describe, expect, it } from 'vitest'
import { buildEnvelope, parseDsn } from '@/shared/sentry'

describe('parseDsn', () => {
  it('derives the envelope endpoint and public key from a standard DSN', () => {
    const p = parseDsn('https://abc123@o42.ingest.sentry.io/4509')
    expect(p).toEqual({ endpoint: 'https://o42.ingest.sentry.io/api/4509/envelope/', publicKey: 'abc123' })
  })

  it('handles a self-hosted DSN with a path prefix', () => {
    const p = parseDsn('https://key@sentry.example.com/inner/7')
    expect(p).toEqual({ endpoint: 'https://sentry.example.com/inner/api/7/envelope/', publicKey: 'key' })
  })

  it('rejects a DSN without a public key', () => {
    expect(parseDsn('https://o0.ingest.sentry.io/1')).toBeNull()
  })

  it('rejects a DSN without a project id', () => {
    expect(parseDsn('https://key@o0.ingest.sentry.io/')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(parseDsn('not-a-url')).toBeNull()
  })
})

describe('buildEnvelope', () => {
  it('produces three NDJSON lines: header, item header, payload', () => {
    const env = buildEnvelope('eid', '2026-01-01T00:00:00.000Z', { event_id: 'eid', level: 'error' })
    const lines = env.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0])).toEqual({ event_id: 'eid', sent_at: '2026-01-01T00:00:00.000Z' })
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' })
    expect(JSON.parse(lines[2])).toEqual({ event_id: 'eid', level: 'error' })
  })
})
