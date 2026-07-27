import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentActions, agentLoops, db, templates, users } from '@/shared/db'
import { autonomyHealthy, publishQuotaLeft, publishedToday, ERROR_STREAK_TRIP } from '@/shared/agents/canary'
import { loopPolicy, resetCircuit } from '@/shared/agents/policy'

// КАНАРЕЙКА — триггеры к предохранителю, который до этого никто не срывал: механизм без
// триггера это иллюзия защиты. Проверяем на реальной БД, потому что все три сигнала —
// это запросы к журналу и состоянию списков, а не чистая логика.

let ownerId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${agentActions}, ${agentLoops}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'canary-agent', accountType: 'agent' }).returning({ id: users.id })
  ownerId = u.id
})

beforeEach(async () => {
  await db.delete(agentActions)
  await db.delete(templates)
  await resetCircuit('gardener')
})

const act = async (over: Partial<typeof agentActions.$inferInsert> = {}) => {
  await db.insert(agentActions).values({ loop: 'gardener', action: 'list.publish', resultStatus: 'ok', ...over })
}

describe('квота автопубликаций', () => {
  it('пусто — квота целая', async () => {
    expect(await publishQuotaLeft('gardener', 3)).toBe(3)
  })

  it('считаются только СВОИ успешные публикации', async () => {
    await act()
    await act({ resultStatus: 'dry-run' }) // решение без действия — не расход квоты
    await act({ action: 'list.hold', resultStatus: 'skipped' })
    await act({ loop: 'selfgen' }) // чужая петля
    expect(await publishQuotaLeft('gardener', 3)).toBe(2)
    expect(await publishedToday('gardener', 3)).toEqual({ used: 1, left: 2 })
  })

  it('квота 0 — публиковать нельзя вовсе (равносильно выключенной планке)', async () => {
    expect(await publishQuotaLeft('gardener', 0)).toBe(0)
  })

  it('исчерпанная квота не уходит в минус', async () => {
    await act()
    await act()
    await act()
    await act()
    expect(await publishQuotaLeft('gardener', 3)).toBe(0)
  })

  it('вчерашние публикации квоту сегодня не тратят', async () => {
    await act()
    await db.execute(sql`update ${agentActions} set occurred_at = now() - interval '1 day'`)
    expect(await publishQuotaLeft('gardener', 3)).toBe(3)
  })
})

describe('здоровье автономии', () => {
  it('чистый журнал — здорова', async () => {
    expect(await autonomyHealthy('gardener')).toBe(true)
    expect((await loopPolicy('gardener')).circuitTripped).toBe(false)
  })

  it('серия ошибок подряд срывает предохранитель с причиной', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await act({ action: 'list.draft', resultStatus: 'error', error: 'boom' })
    expect(await autonomyHealthy('gardener')).toBe(false)
    const p = await loopPolicy('gardener')
    expect(p.circuitTripped).toBe(true)
    expect(p.circuitReason).toContain('ошибок подряд')
  })

  it('успех в серии обнуляет тревогу — неудачный день это не поломка', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP - 1; i++) await act({ resultStatus: 'error' })
    await act({ resultStatus: 'ok' })
    expect(await autonomyHealthy('gardener')).toBe(true)
  })

  it('автономно опубликованный список СНЯЛА модерация — предохранитель рвётся сразу', async () => {
    const [tpl] = await db
      .insert(templates)
      .values({ ownerId, slug: 'bad-list', title: { ru: 'Плохой' }, moderation: 'flagged' })
      .returning({ id: templates.id })
    await act({ signal: { templateId: tpl.id, slug: 'bad-list' } })
    expect(await autonomyHealthy('gardener')).toBe(false)
    expect((await loopPolicy('gardener')).circuitReason).toContain('снят модерацией')
  })

  it('живой опубликованный список тревоги не вызывает', async () => {
    const [tpl] = await db
      .insert(templates)
      .values({ ownerId, slug: 'good-list', title: { ru: 'Годный' }, moderation: 'active' })
      .returning({ id: templates.id })
    await act({ signal: { templateId: tpl.id, slug: 'good-list' } })
    expect(await autonomyHealthy('gardener')).toBe(true)
  })

  it('снять предохранитель может только человек — сам он не восстанавливается', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await act({ resultStatus: 'error' })
    expect(await autonomyHealthy('gardener')).toBe(false)
    // Журнал ошибок остался — повторная проверка снова говорит «нет».
    expect(await autonomyHealthy('gardener')).toBe(false)
    await resetCircuit('gardener')
    expect((await loopPolicy('gardener')).circuitTripped).toBe(false)
  })

  it('чужая петля не отвечает за наши ошибки', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await act({ loop: 'selfgen', resultStatus: 'error' })
    expect(await autonomyHealthy('gardener')).toBe(true)
    await db.delete(agentLoops).where(eq(agentLoops.type, 'selfgen'))
  })
})
