import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ЗАДАЧИ ЧЕРЕЗ MCP ИДУТ ТЕМИ ЖЕ ВОРОТАМИ, ЧТО И ФОРМА.
 *
 * Проверяется не «инструмент отвечает», а то, ради чего инструменты вообще посадили на
 * общее ядро: у агента нет своего пути в обход. Ловим три свойства, каждое из которых
 * ломается молча:
 *
 *  1) ЧАСТОТА. Счётчик задач заводили против скрипта в цикле (#869) — а MCP и есть тот
 *     самый цикл, только узаконенный. Тест смотрит не «есть ли проверка», а КАКИЕ КЛЮЧИ
 *     посчитаны: своя копия лимита у агента дала бы другие ключи и другой поток.
 *  2) ЗАПЕРТОЕ ОБСУЖДЕНИЕ. Форму на сайте прячут, но адрес известен; у MCP прятать
 *     нечего вовсе, там инструмент виден всегда.
 *  3) ОТКАЗ ВМЕСТО ТИХОЙ ПОТЕРИ. Закрытие дубликатом с несуществующим номером не должно
 *     записываться «как дубликат неизвестно чего».
 *
 * И в каждом отказе — что НИЧЕГО НЕ ЗАПИСАНО: отказ, случившийся после записи, хуже
 * отсутствия отказа, потому что выглядит одинаково.
 */
const h = vi.hoisted(() => ({
  rateKeys: [] as string[],
  denyKey: 'нет-такого-ключа',
  opened: [] as unknown[],
  comments: [] as unknown[],
  statuses: [] as { issueId: string; status: string }[],
  events: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  notified: [] as string[],
  originals: [] as { id: string }[],
  locked: null as Date | null,
  issueStatus: 'open' as 'open' | 'closed',
  issueCloseReason: null as string | null,
  canView: true,
}))

const TPL = { id: 'l1', ownerId: 'owner', visibility: 'public', status: 'published', moderation: 'ok', issuesEnabled: true }

vi.mock('@/shared/rate-limit', () => ({
  rateLimit: async (key: string) => {
    h.rateKeys.push(key)
    return { ok: !key.includes(h.denyKey), remaining: 0, resetAt: Date.now() + 60_000 }
  },
}))
vi.mock('@/shared/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.originals }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void h.updates.push(v) }) }),
  },
  issues: {},
}))
vi.mock('@/shared/db/resolve-list', () => ({ resolveListBySlug: async () => TPL }))
vi.mock('@/core', () => ({ canWriteToFeature: () => true, isFeatureEnabled: () => true }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))
vi.mock('@/features/notifications/notify', () => ({
  notifyMany: async (_ids: string[], p: { type: string }) => void h.notified.push(p.type),
  notifyMentions: async () => {},
}))
vi.mock('@/features/watch/subscribe', () => ({ subscribeToList: async () => {} }))
vi.mock('@/features/watch/queries', () => ({ getWatcherIds: async () => [] }))
vi.mock('@/features/collab-store/store', () => ({
  collabStore: {
    openIssue: async (...args: unknown[]) => {
      h.opened.push(args)
      return { id: 'i1', number: 7 }
    },
    addIssueComment: async (...args: unknown[]) => {
      h.comments.push(args)
      return { id: 'c1' }
    },
    setIssueStatus: async (issueId: string, status: string) => void h.statuses.push({ issueId, status }),
  },
  issueCommenterIds: async () => [],
}))
vi.mock('@/features/issues/queries', () => ({
  getListLabels: async () => [],
  loadIssue: async () => ({
    tpl: TPL,
    iss: { id: 'i1', authorId: 'author', status: h.issueStatus, closeReason: h.issueCloseReason, title: 'т', body: 'б', lockedAt: h.locked },
  }),
  getIssue: async () => null,
  getIssues: async () => [],
  getIssueCommentsPage: async () => ({ items: [], next: null, prev: null }),
}))
vi.mock('@/features/issues/events', () => ({
  recordIssueEvent: async (_db: unknown, e: Record<string, unknown>) => void h.events.push(e),
  getIssueEvents: async () => [],
}))
vi.mock('@/features/mcp/tools/shared', () => ({
  SITE_URL: 'https://setfork.com',
  mcpCanView: async () => h.canView,
  resolveListRefOrMoved: async (ref: string) => ({ id: 'l1', slug: 'spisok', ownerHandle: 'owner-user', ownerId: 'owner', movedTo: null, ref }),
}))

const { mcpAddIssueComment, mcpCloseIssue, mcpCreateIssue, mcpSearchIssues } = await import('@/features/mcp/tools/issues')

beforeEach(() => {
  Object.assign(h, {
    rateKeys: [],
    denyKey: 'нет-такого-ключа',
    opened: [],
    comments: [],
    statuses: [],
    events: [],
    updates: [],
    notified: [],
    originals: [{ id: 'orig' }],
    locked: null,
    issueStatus: 'open',
    issueCloseReason: null,
    canView: true,
  })
})

describe('запись через MCP идёт ТЕМ ЖЕ счётчиком частоты, что и форма', () => {
  it('⚠️ создание задачи считает оба ключа — на человека и на список', async () => {
    await mcpCreateIssue('u1', { list: 'owner-user/spisok', title: 'Ошибка в шаге 3' })
    // Ключи — из features/issues/limits, а не свои: у своей копии они были бы другими,
    // и агент шёл бы по отдельному потоку мимо общего порога.
    expect(h.rateKeys, 'счётчик человека').toContain('issue:new:u:u1')
    expect(h.rateKeys, 'счётчик списка').toContain('issue:new:l:l1')
  })

  it('⚠️ переполнение — отказ, и в хранилище не уходит НИЧЕГО', async () => {
    h.denyKey = 'issue:new:u:u1'
    const res = await mcpCreateIssue('u1', { list: 'owner-user/spisok', title: 'Ошибка' })
    expect('error' in res && res.error).toMatch(/rate limit/i)
    expect(h.opened, 'задача не должна быть заведена').toEqual([])
    expect(h.notified, 'и уведомления не рассылаются').toEqual([])
  })

  it('ответ в треде считает СВОЙ поток, а не поток задач', async () => {
    await mcpAddIssueComment('u1', { list: 'owner-user/spisok', number: 7, body: 'ответ' })
    expect(h.rateKeys).toContain('issue:cmt:u:u1')
    expect(h.rateKeys.some((k) => k.startsWith('issue:new:'))).toBe(false)
  })
})

describe('ворота задач одинаковы для агента и для человека', () => {
  it('⚠️ запертое обсуждение не пускает постороннего — и реплика не записывается', async () => {
    h.locked = new Date()
    const res = await mcpAddIssueComment('stranger', { list: 'owner-user/spisok', number: 7, body: 'ещё раз' })
    expect('error' in res && res.error).toMatch(/locked/i)
    expect(h.comments).toEqual([])
  })

  it('пустая реплика — отказ до всякой записи', async () => {
    const res = await mcpAddIssueComment('u1', { list: 'owner-user/spisok', number: 7, body: '   ' })
    expect('error' in res).toBe(true)
    expect(h.comments).toEqual([])
  })

  it('невидимый список не отдаёт задачи наружу', async () => {
    h.canView = false
    const res = await mcpSearchIssues('stranger', { list: 'owner-user/spisok' })
    expect('error' in res && res.error).toBe('list not found')
  })
})

describe('закрытие говорит, чем кончилось, и не теряет ссылку молча', () => {
  it('⚠️ дубликат с несуществующим номером — отказ, статус не меняется', async () => {
    h.originals = []
    const res = await mcpCloseIssue('author', { list: 'owner-user/spisok', number: 7, stateReason: 'duplicate', duplicateOf: 99 })
    expect('error' in res && res.error).toMatch(/no issue with that number/i)
    expect(h.statuses, 'задача не должна закрыться').toEqual([])
    expect(h.events, 'и в ленте не должно появиться записи').toEqual([])
  })

  it('дубликат без номера оригинала не доходит до записи вовсе', async () => {
    const res = await mcpCloseIssue('author', { list: 'owner-user/spisok', number: 7, stateReason: 'duplicate' })
    expect('error' in res && res.error).toMatch(/duplicateOf/)
    expect(h.statuses).toEqual([])
  })

  it('⚠️ повторное закрытие закрытой задачи не пишет НИЧЕГО и никого не будит', async () => {
    // У статуса счётчика частоты нет: каждая такая запись — новое уведомление всем
    // участникам и ещё одна одинаковая строка в ленте. Из браузера это двойное нажатие,
    // через MCP — цикл.
    h.issueStatus = 'closed'
    h.issueCloseReason = 'completed'
    const res = await mcpCloseIssue('author', { list: 'owner-user/spisok', number: 7, stateReason: 'not_planned' })
    expect(res).toMatchObject({ changed: false, state: 'closed', stateReason: 'completed' })
    expect('note' in res && res.note, 'агенту надо сказать, как сменить исход').toMatch(/already closed/i)
    expect(h.statuses, 'в хранилище ничего не уходит').toEqual([])
    expect(h.events, 'и в ленте не появляется второго «закрыл»').toEqual([])
    expect(h.notified, 'и никому не летит уведомление').toEqual([])
  })

  it('успешное закрытие сообщает ИСХОД и оригинал, а не просто «ок»', async () => {
    const res = await mcpCloseIssue('author', { list: 'owner-user/spisok', number: 7, stateReason: 'duplicate', duplicateOf: 3 })
    expect(res).toMatchObject({ state: 'closed', stateReason: 'duplicate', duplicateOf: 3 })
    expect('url' in res && res.url, 'человеку нужен адрес, а не только номер').toContain('/owner-user/spisok/issues/7')
    expect(h.events[0]).toMatchObject({ kind: 'closed', closeReason: 'duplicate' })
    expect(h.notified, 'о закрытии узнают те же, кто узнаёт о реплике').toContain('issue_closed')
  })
})
