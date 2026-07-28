import { afterEach, describe, expect, it, vi } from 'vitest'
import { JOB_TYPES } from '@/shared/db'

// Забытый обработчик — это фича, которая написана, но не исполняется НИ РАЗУ: задачи
// ставятся в очередь, воркер бросает «no handler», после ретраев они тихо уходят в failed.
// Так уехал `gnome_task` (#525): обработчик был написан, но не подключён в composition root,
// и заметил это только автоматический ревьюер в PR. Проверка полноты стоит на старте воркера.

const full = () => Object.fromEntries(JOB_TYPES.map((t) => [t, async () => {}]))

afterEach(() => {
  vi.resetModules()
})

/** startWorker хранит флаг «уже запущен» в модуле — каждый кейс берёт свежую копию. */
const freshWorker = async () => {
  vi.resetModules()
  const { startWorker } = await import('@/shared/jobs/worker')
  return startWorker
}

describe('реестр обработчиков задач', () => {
  it('полный реестр — воркер стартует', async () => {
    const startWorker = await freshWorker()
    expect(() => startWorker(full())).not.toThrow()
  })

  it('забытый обработчик роняет СТАРТ с внятной ошибкой, а не прод через неделю', async () => {
    const startWorker = await freshWorker()
    const handlers = full()
    delete handlers.gnome_task
    expect(() => startWorker(handlers)).toThrow(/gnome_task/)
  })

  it('в ошибке перечислены ВСЕ забытые типы сразу', async () => {
    const startWorker = await freshWorker()
    const handlers = full()
    delete handlers.digest
    delete handlers.feedpull
    expect(() => startWorker(handlers)).toThrow(/digest.*feedpull|feedpull.*digest/)
  })

  it('список типов не пуст и содержит петли и разовые задачи', () => {
    expect(JOB_TYPES.length).toBeGreaterThan(5)
    for (const t of ['generate', 'gardener', 'selfgen', 'gnome_task', 'feedpull']) expect(JOB_TYPES).toContain(t)
  })
})
