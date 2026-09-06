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
const h = vi.hoisted(() => ({
  rateKeys: [] as string[],
  subscribed: [] as string[],
  notified: [] as string[],
  mentionTexts: [] as string[],
}))

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
  notifyMentions: async (p: { text: string }) => void h.mentionTexts.push(p.text),
}))
vi.mock('@/features/watch/subscribe', () => ({ subscribeToList: async (id: string) => void h.subscribed.push(id) }))
vi.mock('@/features/watch/queries', () => ({ getWatcherIds: async () => [] }))
vi.mock('@/features/collab-store/store', () => ({
  collabStore: {
    openIssue: async () => ({ id: 'i1', number: 1 }),
    addIssueComment: async () => ({ id: 'c1' }),
  },
  issueCommenterIds: async () => [],
}))
vi.mock('@/features/issues/queries', () => ({
  getListLabels: async () => [],
  loadIssue: async () => ({
    tpl: TPL,
    iss: { id: 'i1', authorId: 'author', status: 'open', closeReason: null, title: 'т', body: 'б', lockedAt: null },
  }),
}))
vi.mock('@/features/issues/events', () => ({ recordIssueEvent: async () => {} }))

const { commentOnIssue, openIssueOn } = await import('@/features/issues/core')

/** Тело садовника — ЧУЖОЙ текст: битые ссылки, взятые из списка его автора. */
const LINK_WITH_HANDLE = 'Мёртвые ссылки:\n- https://site.example/p?user=@alice'

const open = (writer: 'person' | 'service') =>
  openIssueOn(TPL as never, 'gardener', { title: 'битые ссылки', body: LINK_WITH_HANDLE }, writer)

const comment = (writer: 'person' | 'service') =>
  commentOnIssue('gardener', 'owner-user', 'spisok', 7, `${LINK_WITH_HANDLE}\nи ещё @bob`, writer)

beforeEach(() => Object.assign(h, { rateKeys: [], subscribed: [], notified: [], mentionTexts: [] }))

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

  it('уведомления о самой задаче одинаковы: владелец узнаёт, кто бы её ни завёл', async () => {
    await open('service')
    expect(h.notified).toContain('issue_new')
  })

  it('⚠️ служба не рассылает УПОМИНАНИЙ — иначе автор списка пингует кого угодно от её имени', async () => {
    // Тело садовника собрано из чужого содержимого: битые ссылки берутся из списка,
    // то есть текст выбирает его автор. Адрес `…?user=@alice` проходит разбор упоминаний
    // (перед `@` стоит `=`, а не `/`), и рассылка пошла бы живым людям от имени службы.
    await open('service')
    expect(h.mentionTexts, 'тело службы не должно попадать в разбор упоминаний').toEqual([])
  })

  it('у человека упоминания работают как работали', async () => {
    await open('person')
    expect(h.mentionTexts).toHaveLength(1)
    expect(h.mentionTexts[0]).toContain('@alice')
  })

  it('⚠️ и в КОММЕНТИРОВАНИИ служба тоже не рассылает упоминаний', async () => {
    // Второй путь рассылки. Сегодня служебных комментаторов нет, и раньше путь был
    // закрыт именно этим — отсутствием вызывающего, а не свойством. Тест держит
    // свойство: заведётся служба, отвечающая в треде, — она промолчит, как и должна.
    await comment('service')
    expect(h.mentionTexts).toEqual([])
    expect(h.notified, 'а вот о самой реплике участники узнают').toContain('issue_comment')
  })

  it('человек, отвечая в треде, зовёт упомянутых', async () => {
    await comment('person')
    expect(h.mentionTexts).toHaveLength(1)
    expect(h.mentionTexts[0]).toContain('@bob')
  })
})
