import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * СОРВАВШЕЕСЯ АВТО-СЛИЯНИЕ ОСТАВЛЯЕТ ПРЕДЛОЖЕНИЕ ЧЕЛОВЕКУ — И ГОВОРИТ ЕМУ ОБ ЭТОМ.
 *
 * На кураторском списке правка садовника применяется сразу, без человека. Если список
 * ушёл вперёд, пока работала модель, запись отбивается — и предложение остаётся открытым.
 * Это верный исход: правка не пропала, её просто решает человек на свежем составе.
 *
 * Но раз решает теперь ЧЕЛОВЕК, он обязан узнать. Обычное открытое предложение шлёт
 * владельцу `suggestion_new`; ветка сорвавшегося слияния писала только в журнал — и
 * владелец, который полагается на уведомления, про такую правку не узнавал вовсе.
 * «Тихо оставили ждать» ничем не отличается от «потеряли»: предложения копятся, а
 * следующий проход этот список уже не возьмёт — у него есть открытая правка.
 *
 * Здесь проверяется сам проход, а не помощник: подменено ВНЕШНЕЕ (порт записи, модель,
 * выборка кандидатов), решения ветвления настоящие.
 */

const h = vi.hoisted(() => ({
  refuseWith: null as null | Error,
  notified: [] as { type: string; recipientId: string; suggestionId?: string }[],
  journal: [] as { action: string; resultStatus: string }[],
  accepted: [] as string[],
}))

const candidate = {
  id: 't1',
  slug: 'curated-list',
  ownerId: 'owner1',
  title: { ru: 'Список' },
  desc: { ru: 'Описание' },
  tags: ['devops'],
  currentVersion: 7,
  listKind: 'procedure',
  living: false,
  status: 'published',
  ownerCurated: true,
  ownerAccountType: 'user',
}

vi.mock('@/shared/db', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 's1' }] }) }),
    update: () => ({
      set: (v: { status?: string }) => ({
        where: async () => {
          if (v.status === 'accepted') h.accepted.push('s1')
        },
      }),
    }),
  },
  suggestions: { id: {} },
  templates: { id: {} },
  users: { id: {} },
}))
vi.mock('@/features/notifications/notify', () => ({
  notify: vi.fn(async (n: { type: string; recipientId: string; suggestionId?: string }) => {
    h.notified.push(n)
  }),
  notifyMany: vi.fn(),
}))
vi.mock('@/features/watch/queries', () => ({ getWatcherIds: vi.fn(async () => []) }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: vi.fn() }))
// Порт записи — единственное, что решает исход ветки: отказ ядра по устаревшей версии.
// Сам `publishGardenerVersion` НЕ подменён, он свой и работает по-настоящему.
vi.mock('@/features/library/list-store', () => ({
  listStore: {
    addVersion: vi.fn(async () => {
      if (h.refuseWith) throw h.refuseWith
      return { version: 8 }
    }),
  },
}))
vi.mock('@/shared/ai/generate', () => ({
  generateListRefine: vi.fn(async () => ({
    title: 'Список',
    desc: 'Описание',
    tags: ['devops'],
    items: [{ title: 'улучшенный пункт', desc: 'как надо', command: '', level: 'required', why: '', subtasks: [], refs: [] }],
  })),
}))
vi.mock('@/shared/quota', () => ({ globalBudgetOk: vi.fn(async () => true) }))
vi.mock('@/shared/lib/link-health', () => ({ checkUrls: vi.fn(async () => new Map()) }))
vi.mock('@/shared/ai/feed-pick', () => ({ freshestUsedAt: vi.fn(async () => null) }))
vi.mock('@/shared/settings/ai', () => ({ isAiAvailable: vi.fn(async () => true) }))
vi.mock('@/shared/observability', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/ai/gnome-account', () => ({
  agentUserIds: vi.fn(async () => []),
  professionOf: vi.fn(() => 'generic'),
  tenderForTags: vi.fn(async () => null),
}))
vi.mock('@/shared/agents/policy', () => ({
  loopPolicy: vi.fn(async () => ({ policyVersion: 1, dryRun: false })),
  recordAgentAction: vi.fn(async (a: { action: string; resultStatus: string }) => {
    h.journal.push({ action: a.action, resultStatus: a.resultStatus })
  }),
}))
vi.mock('@/shared/agents/canary', () => ({ autonomyHealthy: vi.fn(async () => true) }))
vi.mock('@/shared/ai/roster', () => ({ getRoster: vi.fn(async () => []) }))
vi.mock('@/features/gardener/sweep/account', () => ({ ensureGardenerUser: vi.fn(async () => ({ id: 'gardener1' })) }))
vi.mock('@/features/gardener/sweep/candidates', () => ({
  pickCandidates: vi.fn(async (_a: string[], _l: number, only?: string) => (only === 'living' ? [] : [candidate])),
  alreadyForked: vi.fn(async () => false),
  stablePasses: vi.fn(async () => 0),
}))
vi.mock('@/features/gardener/sweep/policy', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  policyOverrides: vi.fn(async () => ({})),
}))
vi.mock('@/features/gardener/sweep/readiness-gate', () => ({ gateOwnDraft: vi.fn(async () => 'kept') }))
vi.mock('@/features/gardener/sweep/diverge', () => ({ divergeByFork: vi.fn(async () => null), STABLE_PASSES_BEFORE_FORK: 2 }))
vi.mock('@/features/gardener/sweep/living', () => ({ growLiving: vi.fn(async () => ({ result: 'nothing-new' })) }))
vi.mock('@/features/gardener/sweep/snapshot', () => ({
  snapshotOf: vi.fn(async () => ({
    lang: 'ru',
    kind: 'procedure',
    current: {
      title: 'Список',
      desc: 'Описание',
      tags: ['devops'],
      items: [{ title: 'старый пункт', desc: 'как было', command: '', level: 'required', why: '', subtasks: [], refs: [] }],
    },
  })),
}))

const { ListWriteError } = await import('@/core')
const { runGardenerSweep } = await import('@/features/gardener/service')

beforeEach(() => {
  h.refuseWith = null
  h.notified = []
  h.journal = []
  h.accepted = []
})

const opened = () => h.notified.filter((n) => n.type === 'suggestion_new')

describe('кураторский список: авто-слияние сорвалось по гонке', () => {
  it('владелец получает уведомление — решать теперь ему', async () => {
    h.refuseWith = new ListWriteError('stale')

    await runGardenerSweep()

    expect(opened(), 'предложение осталось ждать молча — владелец о нём не узнает').toHaveLength(1)
    expect(opened()[0]).toMatchObject({ recipientId: 'owner1', suggestionId: 's1' })
    // Предложение НЕ помечено принятым: версии не было.
    expect(h.accepted).toEqual([])
    expect(h.journal.map((j) => j.action)).toContain('list.suggest')
  })

  it('когда слияние прошло — уведомления об открытом предложении нет, оно принято', async () => {
    await runGardenerSweep()

    expect(opened(), 'предложение влито само — ждать нечего').toHaveLength(0)
    expect(h.accepted).toEqual(['s1'])
    expect(h.journal.map((j) => j.action)).toContain('list.improve')
  })
})

describe('обычный список: предложение открывается как раньше', () => {
  it('владельцу уходит уведомление', async () => {
    const { pickCandidates } = await import('@/features/gardener/sweep/candidates')
    vi.mocked(pickCandidates).mockImplementation(
      async (_a: string[], _l: number, only?: string) => (only === 'living' ? [] : [{ ...candidate, ownerCurated: false }]) as never,
    )

    await runGardenerSweep()

    expect(opened()).toHaveLength(1)
    expect(opened()[0]).toMatchObject({ recipientId: 'owner1', suggestionId: 's1' })
  })
})
