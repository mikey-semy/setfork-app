import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, suggestions, templates, users } from '@/shared/db'
import { pickCandidates } from '@/features/gardener/service'

// Интеграция: КОГО компания берёт в уход. Предикат живёт в SQL, поэтому проверяется
// на реальной БД — второй копии правила в TS нет намеренно (разъехалась бы).
//
// Две правки петли качества (2026-07-27), которые тут и зафиксированы:
//   1) списки СЛУЖЕБНЫХ аккаунтов больше НЕ исключаются. Раньше стояло «правку себе не
//      предлагают» — и следствием было, что всё созданное компанией не улучшалось вовсе.
//   2) владельцы БЕЗ ВХОДА (сид-фикстуры) исключены: принять предложение им физически
//      некому, такие правки только копились открытыми (проверено — все 7 висевших были им).

let agentId = ''
let humanId = ''
let fixtureId = ''
const ids: Record<string, string> = {}

const seedList = async (ownerId: string, slug: string, over: Partial<typeof templates.$inferInsert> = {}) => {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  return row.id
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${suggestions}, ${templates}, ${users} restart identity cascade`)
  const [agent] = await db
    .insert(users)
    .values({ handle: 'gc-agent', accountType: 'agent', profession: 'Cook' })
    .returning({ id: users.id })
  const [human] = await db
    .insert(users)
    .values({ handle: 'gc-human', email: 'gc-human@example.com' })
    .returning({ id: users.id })
  // Фикстура: человек по типу аккаунта, но войти нечем — ни пароля, ни oauth, ни почты.
  const [fixture] = await db.insert(users).values({ handle: 'gc-fixture' }).returning({ id: users.id })
  agentId = agent.id
  humanId = human.id
  fixtureId = fixture.id

  // Дефолты таблицы = public + published + active.
  ids.own = await seedList(agentId, 'own-list')
  ids.human = await seedList(humanId, 'human-list')
  ids.fixture = await seedList(fixtureId, 'fixture-list')
  ids.ownPrivate = await seedList(agentId, 'own-private', { visibility: 'private' })
  ids.ownArchived = await seedList(agentId, 'own-archived', { archivedAt: new Date() })
  ids.ownDraft = await seedList(agentId, 'own-draft', { status: 'draft' })
  ids.humanDraft = await seedList(humanId, 'human-draft', { status: 'draft' })
  ids.ownOpenSug = await seedList(agentId, 'own-open-sug')
  await db.insert(suggestions).values({ templateId: ids.ownOpenSug, authorId: agentId, baseVersion: 1, items: [] })
  // Живой список без звёзд: по прежнему порядку (звёзды → давность) он стоял бы в хвосте.
  ids.living = await seedList(agentId, 'own-living', { living: true })
  await db.update(templates).set({ starsCount: 99 }).where(eq(templates.id, ids.human))
})

const slugs = async () => (await pickCandidates([agentId], 50)).map((r) => r.slug).sort()

describe('gardener: кого берём в уход', () => {
  it('свой список компании — берём (раньше исключался)', async () => {
    expect(await slugs()).toContain('own-list')
  })

  it('список живого человека — берём (ему есть кому принять)', async () => {
    expect(await slugs()).toContain('human-list')
  })

  it('фикстура без входа — НЕ берём: принять предложение некому', async () => {
    expect(await slugs()).not.toContain('fixture-list')
  })

  it('свой ЧЕРНОВИК — берём: самогенерация родит черновик, и ухаживать надо за ним', async () => {
    expect(await slugs()).toContain('own-draft')
  })

  it('черновик живого человека — НЕ берём: это его незаконченная работа', async () => {
    expect(await slugs()).not.toContain('human-draft')
  })

  it('свой приватный и свой архивный — не берём (общие ограничения остались)', async () => {
    const s = await slugs()
    expect(s).not.toContain('own-private')
    expect(s).not.toContain('own-archived')
  })

  it('свой список с ОТКРЫТОЙ правкой служебного аккаунта — не берём повторно', async () => {
    expect(await slugs()).not.toContain('own-open-sug')
  })

  it('живой список идёт ПЕРВЫМ: у ленты ценность в свежести, ждать за популярностью нельзя', async () => {
    const rows = await pickCandidates([agentId], 50)
    expect(rows[0]?.slug).toBe('own-living')
    // И признак доезжает до вызывающего — по нему выбирается ветка роста вместо полировки.
    expect(rows[0]?.living).toBe(true)
  })

  it('владелец помечен служебным — признак доезжает до вызывающего (ветка прямой правки)', async () => {
    const rows = await pickCandidates([agentId], 50)
    expect(rows.find((r) => r.slug === 'own-list')?.ownerAccountType).toBe('agent')
    expect(rows.find((r) => r.slug === 'human-list')?.ownerAccountType).toBe('human')
  })
})
