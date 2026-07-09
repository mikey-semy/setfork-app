import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// MCP-прогоны по userId токена (без моков): запуск гейтится видимостью списка,
// а сам прогон приватен — чужой не видит и не отмечает шаги (run.userId scope).
const { db, templates, users } = await import('@/shared/db')
const { mcpCreateList, mcpStartRun, mcpGetRun, mcpCheckStep } = await import('@/features/mcp/tools')

let ownerId = ''
let otherId = ''
let slug = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'mrowner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'mrother' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
  const created = await mcpCreateList(ownerId, { title: 'Runnable', items: [{ title: 's1' }, { title: 's2' }] })
  slug = (created as { ref: string }).ref.split('/')[1]
})
afterAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
})

describe('mcp runs — видимость на старте + приватность прогона', () => {
  it('чужой не может запустить прогон чужого черновика (forbidden)', async () => {
    expect(await mcpStartRun(otherId, 'mrowner', slug)).toMatchObject({ error: expect.stringContaining('forbidden') })
  })

  it('владелец запускает прогон, отмечает шаг, прогресс растёт', async () => {
    const run = await mcpStartRun(ownerId, 'mrowner', slug)
    const runId = (run as { runId: string }).runId
    expect(runId).toBeTruthy()
    expect(run).toMatchObject({ progress: { done: 0, total: 2 } })

    const after = await mcpCheckStep(ownerId, runId, 1, { done: true })
    expect(after).toMatchObject({ progress: { done: 1, total: 2 } })

    // несуществующий шаг
    expect(await mcpCheckStep(ownerId, runId, 9, { done: true })).toMatchObject({ error: expect.stringContaining('step not found') })
  })

  it('чужой не видит и не отмечает чужой прогон (run.userId scope)', async () => {
    const run = await mcpStartRun(ownerId, 'mrowner', slug) // продолжает активный прогон владельца
    const runId = (run as { runId: string }).runId
    expect(await mcpGetRun(otherId, runId)).toMatchObject({ error: expect.stringContaining('run not found') })
    expect(await mcpCheckStep(otherId, runId, 1, { done: true })).toMatchObject({ error: expect.stringContaining('run not found') })
  })
})
