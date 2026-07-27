import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentActions, db } from '@/shared/db'
import { getCompanyDay } from '@/features/admin/development-queries'

// «День компании» — отчёт постфактум по журналу действий. С включённой планкой компания
// публикует без человека, поэтому отчёт обязателен: автономия без отчёта — чёрный ящик.
// Проверяем на реальной БД: разбор по действиям, отделение сухого прогона от сделанного,
// границу суток и то, что причины задержки НЕ теряются (иначе «не прошло» без «почему»).

const put = async (over: Partial<typeof agentActions.$inferInsert> & { daysAgo?: number } = {}) => {
  const { daysAgo = 0, ...rest } = over
  const [row] = await db
    .insert(agentActions)
    .values({ loop: 'gardener', action: 'list.improve', resultStatus: 'ok', ...rest })
    .returning({ id: agentActions.id })
  if (daysAgo) {
    await db.execute(sql`update ${agentActions} set occurred_at = now() - (${daysAgo}::int * interval '1 day') where id = ${row.id}`)
  }
  return row.id
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${agentActions}`)
})

beforeEach(async () => {
  await db.delete(agentActions)
})

describe('день компании', () => {
  it('пустой день — нули и пустая лента, а не выдуманная активность', async () => {
    const d = await getCompanyDay(0)
    expect(d).toMatchObject({ created: 0, improved: 0, published: 0, held: 0, forked: 0, errors: 0 })
    expect(d.events).toEqual([])
  })

  it('разбирает действия по видам', async () => {
    await put({ action: 'list.draft', loop: 'selfgen' })
    await put({ action: 'list.improve' })
    await put({ action: 'list.publish' })
    await put({ action: 'list.fork' })
    await put({ action: 'list.stable', resultStatus: 'skipped' })
    const d = await getCompanyDay(0)
    expect(d).toMatchObject({ created: 1, improved: 1, published: 1, forked: 1, stable: 1 })
  })

  it('сухой прогон считается ОТДЕЛЬНО и не идёт в «сделано»', async () => {
    await put({ action: 'list.draft', resultStatus: 'dry-run' })
    const d = await getCompanyDay(0)
    expect(d.dryRun).toBe(1)
    expect(d.created).toBe(0)
  })

  it('ошибки видны отдельной цифрой', async () => {
    await put({ action: 'list.draft', resultStatus: 'error', error: 'budget-exhausted' })
    expect((await getCompanyDay(0)).errors).toBe(1)
  })

  it('причины задержки собираются и считаются по частоте', async () => {
    await put({ action: 'list.hold', resultStatus: 'skipped', decision: { blockers: ['шагов 3 < планки 5', 'нет тегов'] } })
    await put({ action: 'list.hold', resultStatus: 'skipped', decision: { blockers: ['шагов 3 < планки 5'] } })
    await put({ action: 'list.hold', resultStatus: 'skipped', decision: { blockers: ['линза grounded: fail'] } })
    const d = await getCompanyDay(0)
    expect(d.held).toBe(3)
    expect(d.holdReasons[0]).toEqual({ reason: 'шагов 3 < планки 5', times: 2 })
    expect(d.holdReasons.map((r) => r.reason)).toContain('линза grounded: fail')
  })

  it('вчерашнее в сегодня не попадает и наоборот', async () => {
    await put({ action: 'list.improve', daysAgo: 1 })
    await put({ action: 'list.publish' })
    expect(await getCompanyDay(0)).toMatchObject({ improved: 0, published: 1 })
    expect(await getCompanyDay(1)).toMatchObject({ improved: 1, published: 0 })
  })

  it('в ленте есть время, действие, ссылка и причина — читать можно без SQL', async () => {
    await put({ action: 'list.hold', resultStatus: 'skipped', resultRef: 'bread', agentId: 'cook', decision: { blockers: ['нет описания'] } })
    const [e] = (await getCompanyDay(0)).events
    expect(e).toMatchObject({ action: 'list.hold', ref: 'bread', who: 'cook', note: 'нет описания' })
    expect(e.at instanceof Date).toBe(true)
  })
})
