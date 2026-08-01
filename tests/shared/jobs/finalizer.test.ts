import { afterEach, describe, expect, it, vi } from 'vitest'
import { JOB_TYPES } from '@/shared/db'
import type { JobFinalizer, JobHandler } from '@/shared/jobs/worker'

/**
 * Финализатор — про состояние, которое видит человек.
 *
 * Генерация ставит 'pending' до старта и снимает его в своём `finally`. Убитый процесс
 * (деплой, OOM) до `finally` не доходит: задачу потом хоронит reaper, а на экране остаётся
 * вечный спиннер — совет «работает» неделю. Здесь проверяется, что о похоронах фича узнаёт,
 * и узнаёт РОВНО на окончательной смерти, а не на каждой неудачной попытке.
 */

const claimJob = vi.fn()
const completeJob = vi.fn(async () => {})
const failJob = vi.fn(async () => false)
const reapStalledJobs = vi.fn(async () => ({ reaped: 0, abandoned: [] as unknown[] }))
const claimUnfinalizedJobs = vi.fn(async () => [] as unknown[])
const markFinalized = vi.fn(async () => {})

vi.mock('@/shared/jobs/queue', () => ({ claimJob, claimUnfinalizedJobs, completeJob, failJob, reapStalledJobs, markFinalized, finalizeExhausted: (j: { finalizeAttempts?: number }) => (j.finalizeAttempts ?? 0) >= 5 }))

const full = (over: Record<string, JobHandler> = {}): Record<string, JobHandler> => ({
  ...Object.fromEntries(JOB_TYPES.map((t) => [t, async () => {}] as const)),
  ...over,
})

/** Пустышка-финализатор с ЯВНЫМИ параметрами: иначе у vi.fn нет типа аргументов и до
 *  `mock.calls[0][0]` (проверка, что payload доехал) не добраться. */
const spyFinalizer = () => vi.fn<JobFinalizer>(async () => {})

const job = { id: 'j1', type: 'generate', payload: { generationId: 'gen-1', idx: 2 }, attempts: 2, maxAttempts: 2 }

/** startWorker хранит «уже запущен» в модуле — каждый кейс берёт свежую копию. */
const runOneTick = async (finalizers: Record<string, JobFinalizer>) => {
  vi.resetModules()
  const { startWorker } = await import('@/shared/jobs/worker')
  vi.useFakeTimers()
  startWorker(
    full({
      generate: async () => {
        throw new Error('AI error')
      },
    }),
    finalizers,
  )
  await vi.advanceTimersByTimeAsync(3100)
  vi.useRealTimers()
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('похороны задачи', () => {
  it('попытки кончились → фича узнаёт и получает payload', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    failJob.mockResolvedValueOnce(true)
    const fin = spyFinalizer()

    await runOneTick({ generate: fin })

    expect(fin).toHaveBeenCalledTimes(1)
    expect(fin.mock.calls[0][0]).toEqual({ generationId: 'gen-1', idx: 2 })
  })

  it('впереди ещё попытка → не хороним (иначе экран объявит провал живой задаче)', async () => {
    claimJob.mockResolvedValueOnce({ ...job, attempts: 1 }).mockResolvedValue(null)
    failJob.mockResolvedValueOnce(false)
    const fin = spyFinalizer()

    await runOneTick({ generate: fin })

    expect(fin).not.toHaveBeenCalled()
  })

  it('задачу похоронил reaper (процесс умер) → финализатор всё равно зовут', async () => {
    claimJob.mockResolvedValue(null)
    reapStalledJobs.mockResolvedValueOnce({ reaped: 1, abandoned: [job] })
    const fin = spyFinalizer()

    await runOneTick({ generate: fin })

    expect(fin).toHaveBeenCalledTimes(1)
  })

  it('успешные похороны отмечаются в задаче — повтор не спутать с первым разом', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    failJob.mockResolvedValueOnce(true)

    await runOneTick({ generate: spyFinalizer() })

    expect(markFinalized).toHaveBeenCalledWith(['j1'])
  })

  it('падение финализатора не роняет цикл и НЕ отмечается — иначе похороны потеряны навсегда', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    failJob.mockResolvedValueOnce(true)
    const fin = vi.fn(async () => {
      throw new Error('finalizer boom')
    })

    await expect(runOneTick({ generate: fin })).resolves.toBeUndefined()
    expect(fin).toHaveBeenCalledTimes(1)
    expect(markFinalized).not.toHaveBeenCalled()
  })

  it('потерянные похороны добираются позже: задача уже failed, reaper её не отдаст', async () => {
    // Моргнула база или процесс убили между пометкой 'failed' и вызовом финализатора.
    claimJob.mockResolvedValue(null)
    claimUnfinalizedJobs.mockResolvedValueOnce([job])
    const fin = spyFinalizer()

    await runOneTick({ generate: fin })

    expect(fin).toHaveBeenCalledTimes(1)
    expect(markFinalized).toHaveBeenCalledWith(['j1'])
  })

  it('добор спрашивает ТОЛЬКО типы с финализатором — остальные в выборке не копятся', async () => {
    claimJob.mockResolvedValue(null)

    await runOneTick({ generate: spyFinalizer() })

    expect(claimUnfinalizedJobs).toHaveBeenCalledWith(['generate'])
  })

  it('тип без финализатора — просто ничего не происходит', async () => {
    claimJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    failJob.mockResolvedValueOnce(true)

    await expect(runOneTick({})).resolves.toBeUndefined()
  })
})
