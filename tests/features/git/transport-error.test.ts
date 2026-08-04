import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it } from 'vitest'
import { toTransportError } from '@/features/git/transport-error'

// Раскладка кодов проверяется отдельно от роута: в его тестах адаптер целиком
// мокается, и это правило осталось бы непроверенным — та самая слепота, из-за
// которой ошибки ядра и уходили в 500 фреймворка мимо задуманной ветки.

describe('ошибка ядра → типизированный отказ транспорта', () => {
  it.each([
    [Code.Unavailable, 'unavailable'],
    [Code.DeadlineExceeded, 'timeout'],
    [Code.NotFound, 'not-found'],
    [Code.Internal, 'internal'],
    [Code.PermissionDenied, 'internal'],
  ])('gRPC %s → %s', (code, expected) => {
    const err = toTransportError(new ConnectError('boom', code), 'receive-pack')
    expect(err.code).toBe(expected)
    expect(err.op).toBe('receive-pack')
  })

  it('не-ConnectError считается внутренней ошибкой, а не теряется', () => {
    const err = toTransportError(new Error('сеть отвалилась мимо connect'), 'upload-pack')
    expect(err.code).toBe('internal')
    expect(err.op).toBe('upload-pack')
  })

  it('исходная причина сохраняется — иначе в логе останется только наша обёртка', () => {
    const cause = new ConnectError('ядро легло', Code.Unavailable)
    expect(toTransportError(cause, 'info/refs upload-pack').cause).toBe(cause)
  })

  it('операция попадает в сообщение: по логу видно, что именно упало', () => {
    expect(toTransportError(new ConnectError('x', Code.Unavailable), 'upload-pack').message).toContain('upload-pack')
  })
})
