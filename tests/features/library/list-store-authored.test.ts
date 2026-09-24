import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ФАЙЛЫ АВТОРА И ЯДРО, КОТОРОЕ ИХ МОЖЕТ НЕ ПОНЯТЬ.
 *
 * Подменён только внешний край — клиенты gRPC. Проверяются два замка адаптера:
 *  • ядро не подтвердило возможность — запрос НЕ уходит вовсе;
 *  • ядро подтвердило, но ответило без эха `authored_applied` (его откатили между
 *    проверкой и записью) — вызывающий узнаёт об этом ошибкой, а не верит успеху;
 *  • без файлов в запросе поля нет — ядро переносит набор родителя, как всегда.
 */
const h = vi.hoisted(() => ({
  accepts: true,
  applied: true,
  sent: [] as Record<string, unknown>[],
}))

vi.mock('@/shared/core-transport', () => ({ coreTransport: () => ({}) }))
vi.mock('@connectrpc/connect', async (orig) => ({
  ...(await orig<typeof import('@connectrpc/connect')>()),
  createClient: () => ({
    getCapabilities: async () => ({ enforcesPushRoles: true, acceptsAuthoredFiles: h.accepts }),
    addVersion: async (req: Record<string, unknown>) => {
      h.sent.push(req)
      return { id: 'v', listId: 'l', version: 2, note: '', commitSha: '', createdAtMs: 0n, authorId: '', authoredApplied: h.applied && req.authored !== undefined }
    },
  }),
}))

const { listWriteRemote } = await import('@/features/library/list-store.remote')
const { AuthoredFilesError } = await import('@/core')

const FILE = { path: 'scripts/run.sh', content: new TextEncoder().encode('echo hi'), executable: true }

beforeEach(() => {
  h.accepts = true
  h.applied = true
  h.sent = []
})

describe('адаптер записи: файлы автора', () => {
  it('ядро не умеет — отказ, запрос не уходит', async () => {
    h.accepts = false
    await expect(listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })).rejects.toMatchObject({ code: 'unsupported' })
    expect(h.sent).toEqual([])
  })

  it('ядро ответило без эха — ошибка, а не успех', async () => {
    h.applied = false
    await expect(listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })).rejects.toBeInstanceOf(AuthoredFilesError)
  })

  it('с эхом — успех, набор уехал; пустой набор уезжает пустым, а не пропадает', async () => {
    await listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })
    await listWriteRemote.addVersion('l', { note: '', steps: [], authored: [] })
    expect(h.sent.map((r) => (r.authored as { files: unknown[] } | undefined)?.files.length)).toEqual([1, 0])
  })

  it('без файлов — поля нет, возможность не спрашивается, эхо не требуется', async () => {
    h.accepts = false
    await listWriteRemote.addVersion('l', { note: '', steps: [] })
    expect(h.sent[0].authored).toBeUndefined()
  })
})
