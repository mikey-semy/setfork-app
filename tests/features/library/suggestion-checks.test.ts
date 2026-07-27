import { describe, expect, it, vi } from 'vitest'

// Проверок со ссылками здесь нет (items без URL), поэтому до запроса в БД дело не
// доходит — мок нужен только чтобы импорт модуля не тянул настоящий пул.
vi.mock('@/shared/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  linkChecks: { urlNorm: 'url_norm', verdict: 'verdict' },
}))

const { suggestionChecks } = await import('@/features/library/suggestion-checks')

const base = {
  items: [{ title: { en: 'шаг' } }],
  changedCount: 1,
  baseVersion: 1,
  currentVersion: 1,
  hasConflicts: false,
  branchMissing: false,
  draft: false,
  blockingReview: false,
  unresolvedThreads: 0,
  blockOnUnresolved: true,
  approvals: 0,
  requiredApprovals: 0,
  moderation: 'ok',
  lang: 'ru' as const,
}

const byKey = async (over: Partial<typeof base>) => {
  const out = await suggestionChecks({ ...base, ...over })
  return new Map(out.map((c) => [c.key, c]))
}

/**
 * Проверки — это то, что видит человек ПЕРЕД тем, как нажать «Влить». Если они
 * расходятся с гейтами экшена, получается либо кнопка, которая молча не работает,
 * либо запрет там, где настройка выключена. Оба перекоса уже случались.
 */
describe('suggestionChecks — красное совпадает с гейтом слияния', () => {
  it('нерешённые обсуждения блокируют, когда так настроен список', async () => {
    const m = await byKey({ unresolvedThreads: 2, blockOnUnresolved: true })
    expect(m.get('threads')?.status).toBe('fail')
  })

  it('при выключенной настройке те же обсуждения — предупреждение, а не блок', async () => {
    const m = await byKey({ unresolvedThreads: 2, blockOnUnresolved: false })
    expect(m.get('threads')?.status).toBe('warn')
  })

  it('одобрений не хватает → блокирующая проверка', async () => {
    const m = await byKey({ requiredApprovals: 2, approvals: 1 })
    expect(m.get('approvals')?.status).toBe('fail')
  })

  it('одобрений достаточно → зелено', async () => {
    const m = await byKey({ requiredApprovals: 2, approvals: 2 })
    expect(m.get('approvals')?.status).toBe('ok')
  })

  it('одобрения не требуются → пункта нет вовсе (не пугаем нулём)', async () => {
    const m = await byKey({ requiredApprovals: 0, approvals: 0 })
    expect(m.has('approvals')).toBe(false)
  })

  it('черновик блокирует всегда — это не настройка', async () => {
    const m = await byKey({ draft: true })
    expect(m.get('draft')?.status).toBe('fail')
  })
})
