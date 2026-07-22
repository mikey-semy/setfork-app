import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Доставка watch по уровням против реального Postgres: watcherIds отдаёт получателей
// события, УВАЖАЯ уровень подписки. 'all' — все события; 'custom' — только по events;
// 'ignore'/'participating' (нет строки) — никогда. watchCount не считает ignore.
const { db, templates, users, watches } = await import('@/shared/db')
const { curationStore } = await import('@/features/curation/adapter')

let listId = ''
const ids: Record<string, string> = {}

beforeAll(async () => {
  await db.execute(sql`truncate table ${watches}, ${templates}, ${users} restart identity cascade`)
  const [owner] = await db.insert(users).values({ handle: 'wowner' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: owner.id, slug: 'wlist', title: { en: 'wlist' } })
    .returning({ id: templates.id })
  listId = tpl.id
  for (const h of ['ua', 'ub', 'uc', 'ud', 'ue']) {
    const [u] = await db.insert(users).values({ handle: h }).returning({ id: users.id })
    ids[h] = u.id
  }
  await curationStore.setWatch(listId, ids.ua, 'all')
  await curationStore.setWatch(listId, ids.ub, 'ignore')
  await curationStore.setWatch(listId, ids.uc, 'custom', { issues: true })
  // ud — 'participating' (глобальный дефолт): строку НЕ создаём.
  await curationStore.setWatch(listId, ids.ue, 'custom', { versions: true })
})
afterAll(async () => {
  await db.execute(sql`truncate table ${watches}, ${templates}, ${users} restart identity cascade`)
})

describe('watch-уровни: доставка watcherIds', () => {
  it('issues → all + custom(issues)', async () => {
    expect(new Set(await curationStore.watcherIds(listId, 'issues'))).toEqual(new Set([ids.ua, ids.uc]))
  })
  it('versions → all + custom(versions)', async () => {
    expect(new Set(await curationStore.watcherIds(listId, 'versions'))).toEqual(new Set([ids.ua, ids.ue]))
  })
  it('suggestions → только all (никто не подписан custom на suggestions)', async () => {
    expect(new Set(await curationStore.watcherIds(listId, 'suggestions'))).toEqual(new Set([ids.ua]))
  })
  it('watchCount = all+custom, без ignore/participating', async () => {
    expect(await curationStore.watchCount(listId)).toBe(3) // ua, uc, ue
  })
  it('watchState отражает уровень (участие = нет строки)', async () => {
    expect((await curationStore.watchState(listId, ids.ua)).level).toBe('all')
    expect((await curationStore.watchState(listId, ids.ub)).level).toBe('ignore')
    expect(await curationStore.watchState(listId, ids.uc)).toEqual({ level: 'custom', events: { issues: true } })
    expect((await curationStore.watchState(listId, ids.ud)).level).toBe('participating')
  })
  it('isWatching: true для all/custom, false для ignore/participating', async () => {
    expect(await curationStore.isWatching(listId, ids.uc)).toBe(true)
    expect(await curationStore.isWatching(listId, ids.ub)).toBe(false)
    expect(await curationStore.isWatching(listId, ids.ud)).toBe(false)
  })
  it("setWatch('participating') снимает подписку", async () => {
    await curationStore.setWatch(listId, ids.ua, 'participating')
    expect((await curationStore.watchState(listId, ids.ua)).level).toBe('participating')
    expect(await curationStore.watchCount(listId)).toBe(2) // uc, ue
    expect(new Set(await curationStore.watcherIds(listId, 'versions'))).toEqual(new Set([ids.ue]))
  })
})
