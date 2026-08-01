import { afterEach, describe, expect, it, vi } from 'vitest'
import { JOB_TYPES } from '@/shared/db'
import type { JobHandler } from '@/shared/jobs/worker'

/**
 * Пульс живой задачи.
 *
 * Без него reaper отличает «процесс умер» от «работа долгая» только щедрым таймаутом в 30
 * минут: всё это время экран показывает работу, которой давно нет. Короткий таймаут без пульса
 * поставить было нельзя — отобрал бы живой совет (≈9.5 вызовов модели) и заплатил дважды.
 * Поэтому задача, пока её держат, обязана дышать — и обязана перестать, когда работа кончилась.
 */

const claimJob = vi.fn()
const completeJob = vi.fn(async () => {})
const failJob = vi.fn(async () => false)
const reapStalledJobs = vi.fn(async () => ({ reaped: 0, abandoned: [] as unknown[] }))
const claimUnfinalizedJobs = vi.fn(async () => [] as unknown[])
const markFinalized = vi.fn(async () => {})
const touchJob = vi.fn(async () => {})
const cleanupTerminalJobs = vi.fn(async () => 0)

vi.mock('@/shared/jobs/queue', () => ({
  claimJob,
  claimUnfinalizedJobs,
  completeJob,
  failJob,
  reapStalledJobs,
  markFinalized,
  touchJob,
  cleanupTerminalJobs,
  finalizeExhausted: () => false,
}))

const full = (over: Record<string, JobHandler> = {}): Record<string, JobHandler> => ({
  ...Object.fromEntries(JOB_TYPES.map((t) => [t, async () => {}] as const)),
  ...over,
})

const job = { id: 'j1', type: 'generate', payload: {}, attempts: 1, maxAttempts: 2 }

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

/** Запускает воркер со свежим модулем (флаг «уже запущен» живёт в модуле) и крутит время. */
const runWorker = async (handler: JobHandler, advanceMs: number) => {
  vi.resetModules()
  const { startWorker } = await import('@/shared/jobs/worker')
  vi.useFakeTimers()
  startWorker(full({ generate: handler }))
  await vi.advanceTimersByTimeAsync(advanceMs)
  vi.useRealTimers()
}

describe('пульс задачи', () => {
  it('долгая работа дышит — reaper не примет её за мёртвую', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    // Задача идёт ~50с: три пульса при интервале 15с.
    const slow = () => new Promise<void>((resolve) => setTimeout(resolve, 50_000))

    await runWorker(slow, 60_000)

    expect(touchJob.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(touchJob).toHaveBeenCalledWith('j1', 1) // id + номер попытки: чужой удар не должен продлевать жизнь
  })

  it('работа кончилась — пульс замолкает (иначе завершённая задача «дышала» бы вечно)', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)

    await runWorker(async () => {}, 60_000)

    expect(touchJob).not.toHaveBeenCalled() // успела до первого удара
  })

  it('упавшая задача тоже перестаёт дышать', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    const boom = () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error('boom')), 20_000))

    await runWorker(boom, 90_000)

    // Один удар за 20с работы — и тишина после падения, а не бесконечный поток.
    expect(touchJob.mock.calls.length).toBe(1)
  })
})
