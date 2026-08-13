import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// ОЧЕРЕДЬ РАБОТЫ на реальной БД. Юнит `activation.test.ts` покрывает саму политику на
// придуманных числах, а здесь проверяется то, что живёт только в связке с Postgres:
// история специалиста собирается сырым `max(timestamptz)`, и drizzle отдаёт его СТРОКОЙ.
// Тип `sql<Date>` этого не ловит — 13.08.2026 первый же живой проход самогенерации лёг на
// «getTime is not a function», потому что до того дня ветку не исполняли ни разу.

const { agentActions, councilExperts, db, generationMessages, generations, users } = await import('@/shared/db')
const { activationCandidates, pickWorkQueue } = await import('@/shared/ai/activation-db')

const expert = (id: string, domains: string[]) => ({
  id,
  nameEn: id,
  nameRu: id,
  professionEn: id,
  professionRu: id,
  userId: null,
  ownerId: null,
  lifecycle: 'active' as const,
  orgRole: 'expert' as const,
  tier: '',
  dreams: '',
  persona: 'a test expert.',
  guildEn: '',
  guildRu: '',
  code: '',
  codeRu: '',
  lens: '',
  memory: '',
  domains,
  model: '',
  avatar: id,
  avatarUploaded: false,
  online: false,
  enabled: true,
})

beforeEach(async () => {
  await resetTables([agentActions, generationMessages, generations, councilExperts, users])
})
afterAll(async () => {
  await resetTables([agentActions, generationMessages, generations, councilExperts, users])
})

describe('история специалиста для очереди работы', () => {
  it('давность работы считается по действиям петли, а не падает на строке из max()', async () => {
    await db.insert(agentActions).values({ loop: 'selfgen', action: 'list.draft', resultStatus: 'ok', agentId: 'chef' })

    const [chef] = await activationCandidates([expert('chef', ['cooking'])])

    expect(chef.attempts).toBe(1)
    expect(chef.daysSinceWork).toBe(0) // работал только что — 0 дней, а не исключение
  })

  it('черновики совета тоже считаются работой', async () => {
    const [u] = await db.insert(users).values({ handle: 'act-user' }).returning({ id: users.id })
    const [g] = await db.insert(generations).values({ userId: u.id, query: 'q' }).returning({ id: generations.id })
    await db.insert(generationMessages).values({ generationId: g.id, kind: 'draft', who: 'chef', text: 'черновик' })

    const [chef] = await activationCandidates([expert('chef', ['cooking'])])

    expect(chef.attempts).toBe(1)
    expect(chef.daysSinceWork).toBe(0)
  })

  it('сухой прогон работой не считается — иначе наблюдение двигало бы очередь', async () => {
    await db.insert(agentActions).values({ loop: 'selfgen', action: 'list.draft', resultStatus: 'dry-run', agentId: 'chef' })

    const [chef] = await activationCandidates([expert('chef', ['cooking'])])

    expect(chef.attempts).toBe(0)
    expect(chef.daysSinceWork).toBeNull()
  })

  it('очередь работы собирается целиком — путь прохода самогенерации исполняется', async () => {
    await db.insert(agentActions).values({ loop: 'selfgen', action: 'list.draft', resultStatus: 'ok', agentId: 'chef' })

    const queue = await pickWorkQueue([expert('chef', ['cooking']), expert('coder', ['programming'])])

    expect(queue.length).toBeGreaterThan(0)
    expect(queue.map((s) => s.id)).toContain('coder') // кому нет оснований — первым
  })
})
