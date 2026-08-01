import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Выборка «похороны ещё не состоялись».
 *
 * Быстрый путь (позвать финализатор сразу после смерти задачи) переживает не всё: моргнула
 * база, процесс убили между пометкой 'failed' и вызовом. Задача при этом уже не 'processing',
 * и reaper её не предложит НИКОГДА — «в процессе» у фичи останется навсегда. Отсюда воркер
 * такие задачи и добирает, поэтому выборка обязана быть точной.
 */

const { db, jobs } = await import('@/shared/db')
const { unfinalizedJobs, markFinalized } = await import('@/shared/jobs/queue')

const add = (over: Partial<typeof jobs.$inferInsert>) =>
  db
    .insert(jobs)
    .values({ type: 'generate', payload: { generationId: 'g' }, status: 'failed', ...over })
    .returning({ id: jobs.id })

beforeEach(async () => {
  await db.execute(sql`truncate table ${jobs} restart identity cascade`)
})

describe('незакрытые похороны', () => {
  it('берём только умершие окончательно и только с финализатором', async () => {
    const [dead] = await add({})
    await add({ status: 'pending' }) // ещё в очереди
    await add({ status: 'processing' }) // в работе — это территория reaper
    await add({ type: 'reindex' }) // финализатора нет

    const got = await unfinalizedJobs(['generate'])

    expect(got.map((j) => j.id)).toEqual([dead.id])
  })

  it('отмеченные не возвращаются — иначе финализатор звали бы вечно', async () => {
    const [dead] = await add({})

    await markFinalized([dead.id])

    expect(await unfinalizedJobs(['generate'])).toHaveLength(0)
    const [row] = await db.select({ at: jobs.finalizedAt }).from(jobs).where(eq(jobs.id, dead.id))
    expect(row.at).toBeInstanceOf(Date)
  })

  it('без типов с финализатором в базу вообще не ходим', async () => {
    await add({})
    expect(await unfinalizedJobs([])).toHaveLength(0)
  })

  it('лимит держит проход коротким — старые разгребутся следующими тиками', async () => {
    for (let i = 0; i < 4; i++) await add({})

    expect(await unfinalizedJobs(['generate'], 2)).toHaveLength(2)
  })
})
