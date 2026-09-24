import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ФАЙЛЫ АВТОРА И ЯДРО, КОТОРОЕ ИХ МОЖЕТ НЕ ПОНЯТЬ.
 *
 * Подменён только внешний край — клиенты gRPC. Проверяется адаптер записи:
 *  • ядро не подтвердило возможность (или не ответило) — запрос НЕ уходит вовсе;
 *  • ядро ответило без эха `authored_applied` — адаптер отдаёт это ВЫЗЫВАЮЩЕМУ полем, а не
 *    исключением: версия к этому моменту записана, и исключение отрезало бы барьеры
 *    фасада (модерацию) от записанного;
 *  • отказ `AUTHORED_INVALID` ядра — `AuthoredFilesError('invalid')` с текстом ядра;
 *  • без файлов поля нет, возможность не спрашивается — и у правки, и у рождения.
 */
const h = vi.hoisted(() => ({
  caps: { enforcesPushRoles: true, acceptsAuthoredFiles: true } as Record<string, boolean> | null,
  applied: true,
  refuse: '' as string,
  sent: [] as Record<string, unknown>[],
}))

vi.mock('@/shared/core-transport', () => ({ coreTransport: () => ({}) }))
vi.mock('@connectrpc/connect', async (orig) => {
  const real = await orig<typeof import('@connectrpc/connect')>()
  const answer = (req: Record<string, unknown>) => {
    h.sent.push(req)
    if (h.refuse) {
      const md = new Headers({ 'sf-reason': 'AUTHORED_INVALID' })
      throw new real.ConnectError(h.refuse, real.Code.InvalidArgument, md)
    }
    return h.applied && req.authored !== undefined
  }
  return {
    ...real,
    createClient: () => ({
      getCapabilities: async () => {
        if (!h.caps) throw new Error('unreachable')
        return h.caps
      },
      addVersion: async (req: Record<string, unknown>) => ({
        id: 'v', listId: 'l', version: 2, note: '', commitSha: '', createdAtMs: 0n, authorId: '', authoredApplied: answer(req),
      }),
      create: async (req: Record<string, unknown>) => ({
        id: 'l', ownerId: 'o', slug: 's', tags: [], status: 'draft', visibility: 'public', moderation: 'active', moderationReason: '',
        origin: 'authored', forkedFromId: '', currentVersion: 1, createdAtMs: 0n, updatedAtMs: 0n, authoredApplied: answer(req),
      }),
    }),
  }
})

const { listWriteRemote } = await import('@/features/library/list-store.remote')

const FILE = { path: 'scripts/run.sh', content: new TextEncoder().encode('echo hi'), executable: true }
const LIST = {
  ownerId: 'o', slug: 's', title: {}, desc: {}, tags: [], ordered: true, visibility: 'public' as const, status: 'draft' as const,
  origin: 'authored' as const, note: '', steps: [],
}

beforeEach(() => {
  h.caps = { enforcesPushRoles: true, acceptsAuthoredFiles: true }
  h.applied = true
  h.refuse = ''
  h.sent = []
})

describe('адаптер записи: файлы автора', () => {
  it('ядро не умеет — отказ, запрос не уходит; не ответило — отказ со своей причиной', async () => {
    h.caps = { enforcesPushRoles: true, acceptsAuthoredFiles: false }
    await expect(listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })).rejects.toMatchObject({ code: 'unsupported' })
    h.caps = null
    await expect(listWriteRemote.create({ ...LIST, authored: [FILE] })).rejects.toMatchObject({ code: 'unsupported', detail: expect.stringContaining('did not answer') })
    expect(h.sent).toEqual([])
  })

  it('без эха — поле ответа, а не исключение (правка и рождение)', async () => {
    h.applied = false
    expect(await listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })).toMatchObject({ authoredApplied: false })
    expect(await listWriteRemote.create({ ...LIST, authored: [FILE] })).toMatchObject({ authoredApplied: false })
  })

  it('с эхом — набор уехал; пустой набор уезжает пустым, а не пропадает', async () => {
    expect(await listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })).toMatchObject({ authoredApplied: true })
    await listWriteRemote.addVersion('l', { note: '', steps: [], authored: [] })
    expect(h.sent.map((r) => (r.authored as { files: unknown[] } | undefined)?.files.length)).toEqual([1, 0])
  })

  it('AUTHORED_INVALID ядра — AuthoredFilesError("invalid") с его текстом', async () => {
    h.refuse = 'scripts/x/deep.sh is not allowed'
    await expect(listWriteRemote.addVersion('l', { note: '', steps: [], authored: [FILE] })).rejects.toMatchObject({
      code: 'invalid',
      detail: 'scripts/x/deep.sh is not allowed',
    })
    await expect(listWriteRemote.create({ ...LIST, authored: [FILE] })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('без файлов — поля нет, возможность не спрашивается, эха в ответе нет', async () => {
    h.caps = { enforcesPushRoles: true, acceptsAuthoredFiles: false }
    const v = await listWriteRemote.addVersion('l', { note: '', steps: [] })
    const l = await listWriteRemote.create(LIST)
    expect(h.sent.map((r) => r.authored)).toEqual([undefined, undefined])
    expect(v).not.toHaveProperty('authoredApplied')
    expect(l).not.toHaveProperty('authoredApplied')
  })
})
