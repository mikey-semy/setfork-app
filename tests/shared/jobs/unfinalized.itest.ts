import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Захват «похороны ещё не состоялись».
 *
 * Быстрый путь (позвать финализатор сразу после смерти задачи) переживает не всё: моргнула
 * база, процесс убили между пометкой 'failed' и вызовом. Задача при этом уже не 'processing',
 * и reaper её не предложит НИКОГДА — «в процессе» у фичи останется навсегда. Отсюда воркер
 * такие задачи и добирает, поэтому выборка обязана быть точной, а попытки — конечными
 * (Oban Lifeline метит исчерпавшую попытки задачу 'discarded', River rescuer отбрасывает —
 * без предела стабильно падающий финализатор перезывался бы каждую минуту вечно).
 */

const { db, jobs } = await import('@/shared/db')
const { claimUnfinalizedJobs, markFinalized } = await import('@/shared/jobs/queue')

const add = (over: Partial<typeof jobs.$inferInsert> = {}) =>
  db
    .insert(jobs)
    .values({ type: 'generate', payload: { generationId: 'g' }, status: 'failed', ...over })
    .returning({ id: jobs.id })

beforeEach(async () => {
  await db.execute(sql`truncate table ${jobs} restart identity cascade`)
})

describe('незакрытые похороны', () => {
  it('берём только умерших окончательно и только с финализатором', async () => {
    const [dead] = await add()
    await add({ status: 'pending' }) // ещё в очереди
    await add({ status: 'processing' }) // в работе — это территория reaper
    await add({ type: 'reindex' }) // финализатора нет

    const got = await claimUnfinalizedJobs(['generate'])

    expect(got.map((j) => j.id)).toEqual([dead.id])
  })

  it('захват считает попытку СРАЗУ — иначе смерть процесса тут не оставит следа', async () => {
    await add()

    const [claimed] = await claimUnfinalizedJobs(['generate'])

    expect(claimed.finalizeAttempts).toBe(1)
  })

  it('исчерпавшие попытки больше не берём — вечного цикла не будет', async () => {
    await add({ finalizeAttempts: 5 })

    expect(await claimUnfinalizedJobs(['generate'])).toHaveLength(0)
  })

  it('пять неудачных заходов подряд — и задача выпадает сама', async () => {
    await add()

    for (let i = 0; i < 5; i++) await claimUnfinalizedJobs(['generate']) // финализатор падал каждый раз

    expect(await claimUnfinalizedJobs(['generate'])).toHaveLength(0)
  })

  it('отмеченные не возвращаются — иначе финализатор звали бы снова', async () => {
    const [dead] = await add()

    await markFinalized([dead.id])

    expect(await claimUnfinalizedJobs(['generate'])).toHaveLength(0)
    const [row] = await db.select({ at: jobs.finalizedAt }).from(jobs).where(eq(jobs.id, dead.id))
    expect(row.at).toBeInstanceOf(Date)
  })

  it('без типов с финализатором в базу вообще не ходим', async () => {
    await add()
    expect(await claimUnfinalizedJobs([])).toHaveLength(0)
  })

  it('лимит держит проход коротким — остальные разгребутся следующими тиками', async () => {
    for (let i = 0; i < 4; i++) await add()

    expect(await claimUnfinalizedJobs(['generate'], 2)).toHaveLength(2)
  })
})
