import { describe, expect, it, vi } from 'vitest'

// Провод create: то, что фасад решил, обязано доехать до ядра. Между решением
// (initialModeration) и вставкой в Postgres стоит remote-адаптер — если он поле не
// положит в запрос, ядро запишет свой дефолт ('active'), и премодерация исчезнет
// молча, при зелёном тесте фасада. Поэтому запрос перехватывается на границе
// Connect-клиента и проверяется как есть.
const h = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }))

vi.mock('@/shared/core-transport', () => ({ coreTransport: () => ({}) }))
vi.mock('@connectrpc/connect', async (orig) => ({
  ...(await orig<typeof import('@connectrpc/connect')>()),
  createClient: () => ({
    create: async (req: Record<string, unknown>) => {
      h.sent.push(req)
      return { id: 'new-id', title: { v: {} }, desc: { v: {} }, tags: [], subtasks: [], refs: [] }
    },
  }),
}))

const { listWriteRemote } = await import('@/features/library/list-store.remote')

const input = {
  ownerId: 'owner-1',
  slug: 'list',
  title: { en: 'L' },
  desc: {},
  tags: [],
  ordered: true,
  visibility: 'public' as const,
  status: 'published' as const,
  origin: 'forked' as const,
  note: 'initial',
  steps: [],
}

describe('listWriteRemote.create — состояние публикации в проводе', () => {
  it('решённое состояние уезжает в ядро полем запроса', async () => {
    await listWriteRemote.create({ ...input, moderation: 'pending' })
    expect(h.sent.at(-1)?.moderation).toBe('pending')
  })

  it('не заданное состояние = пустая строка (ядро подставит active)', async () => {
    await listWriteRemote.create(input)
    expect(h.sent.at(-1)?.moderation).toBe('')
  })
})
