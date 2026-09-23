import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Расписание подметальщика прямых загрузок: ровно одна отложенная задача, и
 * обработчик перепланирует даже при сбое прохода. Подменено только хранилище.
 */
const s3 = vi.hoisted(() => ({ deleteObject: vi.fn(async () => {}) }))
vi.mock('@/shared/media/s3', () => ({
  deleteObject: s3.deleteObject,
  presignPost: vi.fn(),
  headObject: vi.fn(),
  readHead: vi.fn(),
  signedGetUrl: vi.fn(),
}))

const { db, jobs, uploads, users } = await import('@/shared/db')
const { clearMediaCache } = await import('@/shared/settings/media')
const { ensureUploadsSweepScheduled, runUploadsSweepJob, UPLOADS_SWEEP_MS } = await import('@/shared/media/sweep-job')
const { PENDING_TTL_MS } = await import('@/shared/media/direct-upload')

const pendingSweeps = () =>
  db.select().from(jobs).where(and(eq(jobs.type, 'uploads_sweep'), eq(jobs.status, 'pending')))

const S3_KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const
const saved = Object.fromEntries(S3_KEYS.map((k) => [k, process.env[k]]))
afterAll(() => {
  for (const k of S3_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  clearMediaCache()
})

beforeEach(async () => {
  await resetTables([jobs, uploads, users])
  Object.assign(process.env, { S3_ENDPOINT: 'https://s3.test', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' })
  clearMediaCache()
  s3.deleteObject.mockReset()
})

describe('ensureUploadsSweepScheduled', () => {
  it('ставит одну отложенную задачу; повтор вторую не ставит', async () => {
    await ensureUploadsSweepScheduled()
    await ensureUploadsSweepScheduled()
    const rows = await pendingSweeps()
    expect(rows).toHaveLength(1)
    const delay = rows[0].runAt.getTime() - Date.now()
    expect(delay).toBeGreaterThan(UPLOADS_SWEEP_MS - 60_000)
    expect(rows[0].maxAttempts).toBe(1)
  })
})

describe('runUploadsSweepJob', () => {
  it('проход убирает брошенное и ставит следующий', async () => {
    const [u] = await db.insert(users).values({ handle: 'sweeper-u' }).returning({ id: users.id })
    await db.insert(uploads).values({
      userId: u.id, kind: 'file', key: 'files/x/old.pdf', name: 'old.pdf', size: 1,
      contentType: 'application/octet-stream', createdAt: new Date(Date.now() - PENDING_TTL_MS - 60_000),
    })
    await runUploadsSweepJob()
    expect(s3.deleteObject).toHaveBeenCalledWith('files/x/old.pdf', 'uploads')
    expect(await db.select().from(uploads)).toHaveLength(0)
    expect(await pendingSweeps()).toHaveLength(1)
  })

  it('сбой прохода — ошибка наружу, но следующий проход поставлен', async () => {
    // Настоящий сбой базы, без подмены своего кода: таблицы загрузок на время нет.
    await db.execute(sql`alter table uploads rename to uploads_off`)
    try {
      await expect(runUploadsSweepJob()).rejects.toThrow()
    } finally {
      await db.execute(sql`alter table uploads_off rename to uploads`)
    }
    expect(await pendingSweeps()).toHaveLength(1)
  })
})
