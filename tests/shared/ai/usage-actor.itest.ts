import { describe, expect, it, beforeEach } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЖУРНАЛ РАСХОДА САМ ПОНИМАЕТ, КТО ПОЗВАЛ.
 *
 * Признак ставится не аргументом на каждом из тридцати с лишним мест записи, а контекстом
 * исполнения: работа компании помечается один раз, в диспетчере петель. Здесь проверяется
 * именно связь «контекст → строка в журнале» — без неё пометка есть, а в базе её нет.
 */
const { db, aiUsage } = await import('@/shared/db')
const { recordUsage } = await import('@/shared/ai/usage')
const { runAsCompany } = await import('@/shared/ai/actor-context')

const write = () => recordUsage({ feature: 'refine', model: 'test', input: 1, output: 1, total: 2, cost: 0 })
const actors = async () => (await db.select({ actor: aiUsage.actor }).from(aiUsage)).map((r) => r.actor)

beforeEach(async () => {
  await resetTables([aiUsage])
})

describe('признак вызывавшего в журнале расхода', () => {
  it('обычный вызов пишется как пользовательский', async () => {
    await write()
    expect(await actors()).toEqual(['user'])
  })

  it('вызов внутри работы компании пишется как её', async () => {
    await runAsCompany(write)
    expect(await actors()).toEqual(['company'])
  })

  it('после работы компании запись снова пользовательская', async () => {
    await runAsCompany(write)
    await write()
    expect((await actors()).sort()).toEqual(['company', 'user'])
  })
})
