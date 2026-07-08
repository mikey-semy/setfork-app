import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestError } from './instrumentation'

// Проверяем проводку observability-хука: onRequestError → captureError → структурный
// error-лог (console.error). Реальная цепочка, без запуска Next.
describe('onRequestError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('логирует ошибку через captureError (console.error со стеком и контекстом)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await onRequestError(new Error('boom-xyz'), { path: '/acme/list', method: 'POST' }, { routePath: '/[handle]/[slug]', routeType: 'action' })
    expect(spy).toHaveBeenCalledTimes(1)
    const line = String(spy.mock.calls[0][0])
    expect(line).toContain('boom-xyz')
    expect(line).toContain('/acme/list')
    expect(line).toContain('action')
  })

  it('не-Error значение тоже не роняет хук', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(onRequestError('string error', {}, {})).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
