import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * КТО ОТВЕЧАЕТ В КИРКЕ: выбор человека → проводник по пункту (Jev) → правило по тегам.
 *
 * Порядок — единственное, что здесь решается, поэтому проверяется он, а не текст ответа:
 * какой гном доехал до `gnomeConverse`. Подменено внешнее — ответ модели-собеседника,
 * эмбеддинги прецедентов, сеть до Decisions — и общие гейты доступа (сессия, квоты,
 * лимит), которые проверены в своих тестах.
 */
const h = vi.hoisted(() => ({ session: { userId: '', handle: 'chat-owner' } }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('@/shared/settings/ai', async (orig) => ({
  ...(await orig()),
  getOpenRouterApiKey: async () => 'k',
  isAiAvailable: async () => true,
  getAiSettings: async () => ({ enabled: true }),
}))
// Предохранитель расхода. Его спрашивают несколько мест (вход, каждый вызов Decisions, в
// том числе теневой в фоне), и порядок вызовов не задан — поэтому состояние, а не очередь
// ответов: бюджет «кончается» в момент, который задаёт тест.
const budget = vi.hoisted(() => ({ exhausted: false }))
vi.mock('@/shared/quota', async (orig) => ({
  ...(await orig()),
  globalBudgetOk: async () => !budget.exhausted,
  aiQuota: async () => ({ ok: true }),
}))
vi.mock('@/shared/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
vi.mock('@/shared/ai/retrieval', () => ({ findPrecedents: async () => ({ lists: [], steps: [] }) }))

const spoke = vi.fn()
const ROSTER = [
  { id: 'dba', persona: 'a database engineer. Indexes first.', domains: ['postgresql', 'sql'] },
  { id: 'devops', persona: 'a pragmatic DevOps/SRE expert. Reliability is a number.', domains: ['devops', 'deploy'] },
  { id: 'generalist', persona: 'a well-rounded generalist. Classify first.', domains: ['*'] },
]
vi.mock('@/shared/ai/gnomes', async (orig) => ({
  ...(await orig()),
  getRoster: async () => ROSTER,
  gnomeConverse: async (expert: { id: string }) => {
    spoke(expert.id)
    return [{ who: expert.id, text: 'ответ' }]
  },
}))

const { db, digChatMessages, digGuides, steps, templates, templateVersions, users } = await import('@/shared/db')
const { digChatAsk } = await import('@/features/dig/chat-actions')

const decision = (id: string) =>
  new Response(
    JSON.stringify({
      model: 'typesafe/jev-1.13-20260917',
      answers: { guide: { type: 'choice', choice: id, probabilities: { [id]: 0.9 }, confidence: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1, cost: 0.00001 },
    }),
  )
const fits = () =>
  new Response(JSON.stringify({ model: 'm', answers: { fits: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 1, output_tokens: 1, cost: 0 } }))

let tplId = ''
const ask = (gnome: string) => digChatAsk({ templateId: tplId, stepN: 1, gnome, history: [], question: 'почему так?', lang: 'ru' })

beforeEach(async () => {
  budget.exhausted = false
  vi.restoreAllMocks()
  spoke.mockClear()
  await resetTables([digChatMessages, digGuides, steps, templateVersions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'chat-owner' }).returning({ id: users.id })
  h.session.userId = u.id
  // Теги списка — про DevOps: правило по тегам отдало бы пункт ему целиком.
  const [t] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'slow-api', title: { ru: 'Медленное API' }, tags: ['devops'], status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  tplId = t.id
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1 }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, type: 'step', title: { ru: 'Найти медленные запросы: pg_stat_statements' } })
})

describe('кто отвечает в кирке', () => {
  it('выбор человека главнее всего — модель проводника не спрашивают', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    await ask('generalist')
    expect(spoke).toHaveBeenCalledWith('generalist')
    expect(spy).not.toHaveBeenCalled()
  })

  it('«авто» — проводник по пункту: Jev отдал его DBA, хотя теги списка про DevOps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(decision('dba')).mockResolvedValueOnce(fits())
    await ask('auto')
    expect(spoke).toHaveBeenCalledWith('dba')
  })

  it('зависший теневой вопрос ответ не задерживает', async () => {
    let release: () => void = () => {}
    const hang = new Promise<void>((r) => (release = r))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      if (body.questions.fits) {
        await hang
        return fits()
      }
      return decision('dba')
    })
    // Ответ пришёл, пока тень ещё висит.
    const res = await ask('auto')
    expect('replies' in res).toBe(true)
    release()
  })

  it('вопрос проводнику исчерпал бюджет — дорогой ответ гнома не зовётся', async () => {
    // Бюджет кончается ровно на ответе Jev о проводнике: вход его ещё видел, а ответ гнома
    // — уже нет.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      if (body.questions.fits) return fits()
      budget.exhausted = true
      return decision('dba')
    })
    const res = await ask('auto')
    expect(res).toEqual({ error: 'budget' })
    expect(spoke).not.toHaveBeenCalled()
  })

  it('Jev не ответил — прежнее правило по тегам, кирка не падает', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }))
    const res = await ask('auto')
    expect('replies' in res).toBe(true)
    expect(spoke).toHaveBeenCalledWith('devops')
  })
})
