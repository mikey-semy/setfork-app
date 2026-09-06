import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * СЛУЖБА ПИШЕТ ЗАДАЧИ ИНАЧЕ, ЧЕМ ЧЕЛОВЕК, — И РОВНО В ДВУХ МЕСТАХ.
 *
 * Садовник ходит по расписанию: за один ночной обход он законно заводит по задаче в
 * десятках списков. Личный порог (20 задач в минуту — пик ЧЕЛОВЕКА, см. limits.ts)
 * обрезал бы такой обход на двадцатом, причём МОЛЧА: тридцать списков остались бы без
 * находки, а в журнале стояло бы «доставлено». Поэтому службе считают только ключ
 * СПИСКА — он и защищает от того, ради чего счётчик заводили: от цикла в одну цель.
 *
 * Второе отличие — подписка. Человек, заведя задачу, начинает следить за списком: он
 * ждёт ответа. Садовник ответа не ждёт, и подписка сделала бы его вечным получателем
 * чужих разговоров во всех списках, к которым он прикоснулся.
 *
 * Тест держит именно эти два свойства и НЕ повторяет остальных ворот: право писать,
 * уведомления и след в ленте у службы ровно те же, что у человека, — в том и смысл
 * общего пути.
 */
const h = vi.hoisted(() => ({ rateKeys: [] as string[], subscribed: [] as string[], notified: [] as string[] }))

const TPL = { id: 'l1', ownerId: 'owner', visibility: 'public', status: 'published', moderation: 'ok', issuesEnabled: true }

vi.mock('@/shared/rate-limit', () => ({
  rateLimit: async (key: string) => {
    h.rateKeys.push(key)
    return { ok: true, remaining: 0, resetAt: Date.now() + 60_000 }
  },
}))
vi.mock('@/shared/db', () => ({ db: {}, issues: {} }))
vi.mock('@/shared/db/resolve-list', () => ({ resolveListBySlug: async () => TPL }))
vi.mock('@/core', () => ({ canWriteToFeature: () => true, isFeatureEnabled: () => true }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))
vi.mock('@/features/notifications/notify', () => ({
  notifyMany: async (_ids: string[], p: { type: string }) => void h.notified.push(p.type),
  notifyMentions: async () => {},
}))
vi.mock('@/features/watch/subscribe', () => ({ subscribeToList: async (id: string) => void h.subscribed.push(id) }))
vi.mock('@/features/watch/queries', () => ({ getWatcherIds: async () => [] }))
vi.mock('@/features/collab-store/store', () => ({
  collabStore: { openIssue: async () => ({ id: 'i1', number: 1 }) },
  issueCommenterIds: async () => [],
}))
vi.mock('@/features/issues/queries', () => ({ getListLabels: async () => [], loadIssue: async () => null }))
vi.mock('@/features/issues/events', () => ({ recordIssueEvent: async () => {} }))

const { openIssueOn } = await import('@/features/issues/core')

const open = (writer: 'person' | 'service') =>
  openIssueOn(TPL as never, 'gardener', { title: 'битые ссылки' }, writer)

beforeEach(() => Object.assign(h, { rateKeys: [], subscribed: [], notified: [] }))

describe('служебный писатель', () => {
  it('⚠️ личный порог службе не считают — иначе ночной обход обрежется на двадцатом списке', async () => {
    await open('service')
    expect(h.rateKeys.some((k) => k.startsWith('issue:new:u:')), 'личного ключа быть не должно').toBe(false)
    expect(h.rateKeys, 'а ключ списка остаётся: цикл в один список ловится').toContain('issue:new:l:l1')
  })

  it('служба не подписывается на список, к которому прикоснулась', async () => {
    await open('service')
    expect(h.subscribed).toEqual([])
  })

  it('человек считается обоими ключами и подписывается — как было', async () => {
    await open('person')
    expect(h.rateKeys).toContain('issue:new:u:gardener')
    expect(h.rateKeys).toContain('issue:new:l:l1')
    expect(h.subscribed).toEqual(['l1'])
  })

  it('уведомления одинаковы: владелец узнаёт о задаче, кто бы её ни завёл', async () => {
    await open('service')
    expect(h.notified).toContain('issue_new')
  })
})
