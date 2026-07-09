import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Движок модерации против реального Postgres. Мокаем ТОЛЬКО ключ ИИ (иначе гейт
// выключен на стендах) — сама логика гейта/recheck/дедупа настоящая, БД настоящая.
// LLM-классификатор (moderateContent) НЕ дёргаем: тестируем маршрутизацию, не вердикт.
vi.mock('@/shared/settings/ai', () => ({
  getApiKey: async () => 'test-key',
  getAiSettings: async () => ({ enabled: true }),
}))

const { db, templates, users, jobs } = await import('@/shared/db')
const { gateListPublication, recheckList } = await import('@/features/moderation/moderate-list')

let ownerId = ''

async function seedList(over: Partial<typeof templates.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug: `g-${Math.random().toString(36).slice(2)}`, title: { en: 'G' }, ...over })
    .returning({ id: templates.id })
  return row.id
}
const modOf = async (id: string) => (await db.query.templates.findFirst({ where: (t, { eq: e }) => e(t.id, id) }))?.moderation
const jobCount = async (id: string) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, 'moderate'), sql`${jobs.payload}->>'templateId' = ${id}`))
  return r?.n ?? 0
}

beforeEach(async () => {
  await db.execute(sql`truncate table ${templates}, ${users}, ${jobs} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'gowner' }).returning({ id: users.id })
  ownerId = o.id
})
afterAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users}, ${jobs} restart identity cascade`)
})

describe('gateListPublication — гейт публикации', () => {
  it('недоверенный автор → список уходит в pending + джоба-гейт в очереди', async () => {
    const id = await seedList({ moderation: 'active' })
    await gateListPublication(id)
    expect(await modOf(id)).toBe('pending')
    expect(await jobCount(id)).toBe(1)
  })

  it('flagged НЕ пере-гейтится (остаётся flagged, публикацией не отмыть)', async () => {
    const id = await seedList({ moderation: 'flagged' })
    await gateListPublication(id)
    expect(await modOf(id)).toBe('flagged')
    expect(await jobCount(id)).toBe(0) // джобу не ставим
  })

  it('доверенный автор (curated) публикуется сразу — active, а не pending', async () => {
    await db.update(users).set({ curated: true }).where(eq(users.id, ownerId))
    const id = await seedList({ moderation: 'active' })
    await gateListPublication(id)
    expect(await modOf(id)).toBe('active') // не заперт в pending
    expect(await jobCount(id)).toBe(1) // фоновая пере-проверка всё равно ставится
  })
})

describe('recheckList — фоновая пере-проверка', () => {
  it('публичный список: дедуп — два вызова дают ОДНУ джобу', async () => {
    const id = await seedList({ visibility: 'public', moderation: 'active' })
    await recheckList(id)
    await recheckList(id)
    expect(await jobCount(id)).toBe(1)
  })

  it('приватный список — джоба НЕ ставится (наружу не выставлен)', async () => {
    const id = await seedList({ visibility: 'private', moderation: 'active' })
    await recheckList(id)
    expect(await jobCount(id)).toBe(0)
  })
})
