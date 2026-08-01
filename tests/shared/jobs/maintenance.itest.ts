import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Обслуживание очереди: два порога reaper и уборка терминальных задач.
 *
 * Оба предиката живут в SQL, поэтому `tsc` и юниты их не видят по устройству
 * (runbooks/drizzle-sql-gotchas §3) — проверяем против настоящего Postgres.
 */

const { db, jobs } = await import('@/shared/db')
const { reapStalledJobs, cleanupTerminalJobs, touchJob, failJob } = await import('@/shared/jobs/queue')

const add = (over: Partial<typeof jobs.$inferInsert> = {}) =>
  db
    .insert(jobs)
    .values({ type: 'generate', payload: {}, status: 'processing', attempts: 1, maxAttempts: 2, ...over })
    .returning({ id: jobs.id })

/** Postgres-время, а не Date.now(): часы приложения и базы расходятся, и тест бы врал. */
const ago = (interval: string) => sql`now() - interval '${sql.raw(interval)}'`

beforeEach(async () => {
  await db.execute(sql`truncate table ${jobs} restart identity cascade`)
})

describe('reaper: пульс против таймаута', () => {
  it('пульс свежий → задача живая, не отбираем (иначе двойной расход на модели)', async () => {
    // updated_at древний — раньше этого хватало, чтобы отобрать. Теперь решает пульс.
    await add({ updatedAt: ago('2 hours') as never, heartbeatAt: sql`now()` as never })

    const { reaped } = await reapStalledJobs()

    expect(reaped).toBe(0)
  })

  it('пульс пропал → смерть видна за минуту, а не за полчаса', async () => {
    const [dead] = await add({ heartbeatAt: ago('5 minutes') as never })

    const { reaped } = await reapStalledJobs()

    expect(reaped).toBe(1)
    const [row] = await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, dead.id))
    expect(row.s).toBe('pending') // попытки ещё есть → назад в очередь
  })

  it('задача без пульса (взята прежней версией) судится по старому щедрому порогу', async () => {
    await add({ updatedAt: ago('10 minutes') as never }) // 10 мин < 30 мин порога

    expect((await reapStalledJobs()).reaped).toBe(0)

    await db.update(jobs).set({ updatedAt: ago('2 hours') as never })

    expect((await reapStalledJobs()).reaped).toBe(1)
  })

  it('пульс продлевает жизнь задаче прямо на ходу', async () => {
    const [live] = await add({ heartbeatAt: ago('5 minutes') as never })

    await touchJob(live.id)

    expect((await reapStalledJobs()).reaped).toBe(0)
  })

  it('отпуская задачу, reaper гасит пульс — иначе новую попытку осудят по чужому', async () => {
    // Rolling deploy: попытку может взять воркер прежней версии, который пульса не бьёт.
    // Оставшийся пульс через минуту объявил бы его живую работу мёртвой — двойное исполнение.
    const [j] = await add({ heartbeatAt: ago('5 minutes') as never })

    await reapStalledJobs()

    const [row] = await db.select({ hb: jobs.heartbeatAt, s: jobs.status }).from(jobs).where(eq(jobs.id, j.id))
    expect(row.s).toBe('pending')
    expect(row.hb).toBeNull()
  })

  it('failJob тоже гасит пульс при возврате в очередь', async () => {
    const [j] = await add({ heartbeatAt: sql`now()` as never })

    await failJob({ id: j.id, type: 'generate', payload: {}, attempts: 1, maxAttempts: 2 }, 'boom')

    const [row] = await db.select({ hb: jobs.heartbeatAt, s: jobs.status }).from(jobs).where(eq(jobs.id, j.id))
    expect(row.s).toBe('pending')
    expect(row.hb).toBeNull()
  })
})

describe('уборка терминальных задач', () => {
  const FINALIZED = ['generate'] // ровно то, что воркер берёт из реестра финализаторов

  it('успешные уходят через сутки, свежие остаются', async () => {
    await add({ status: 'done', updatedAt: ago('2 days') as never })
    await add({ status: 'done', updatedAt: ago('1 hour') as never })

    expect(await cleanupTerminalJobs(FINALIZED)).toBe(1)
    expect(await db.select({ id: jobs.id }).from(jobs)).toHaveLength(1)
  })

  it('провалы живут неделю — по ним разбирают инцидент', async () => {
    await add({ status: 'failed', finalizedAt: ago('8 days') as never, updatedAt: ago('8 days') as never })
    await add({ status: 'failed', finalizedAt: ago('2 days') as never, updatedAt: ago('2 days') as never })

    expect(await cleanupTerminalJobs(FINALIZED)).toBe(1)
  })

  it('умерших БЕЗ похорон не трогаем — это не мусор, а невыполненная работа', async () => {
    // Удалив такую строку, мы своими руками вернули бы вечный спиннер из #637.
    await add({ status: 'failed', finalizedAt: null, updatedAt: ago('30 days') as never })

    expect(await cleanupTerminalJobs(FINALIZED)).toBe(0)
  })

  it('у типов БЕЗ финализатора похорон не бывает — их провалы убираются как обычно', async () => {
    // Иначе email/push/reindex копились бы вечно: finalized_at у них пуст по определению.
    await add({ type: 'email', status: 'failed', finalizedAt: null, updatedAt: ago('8 days') as never })

    expect(await cleanupTerminalJobs(FINALIZED)).toBe(1)
  })

  it('живые и ждущие задачи уборке неподвластны', async () => {
    await add({ status: 'pending', updatedAt: ago('60 days') as never })
    await add({ status: 'processing', updatedAt: ago('60 days') as never })

    expect(await cleanupTerminalJobs(FINALIZED)).toBe(0)
  })

  it('лимит держит проход коротким — DELETE не блокирует горячую таблицу', async () => {
    for (let i = 0; i < 4; i++) await add({ status: 'done', updatedAt: ago('2 days') as never })

    expect(await cleanupTerminalJobs(FINALIZED, 24, 7, 2)).toBe(2)
  })
})
