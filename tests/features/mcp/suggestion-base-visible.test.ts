import { describe, expect, it, vi } from 'vitest'

/**
 * УСТАРЕВШАЯ БАЗА ПРЕДЛОЖЕНИЯ ВИДНА АГЕНТУ.
 *
 * Принятие предложения «из пунктов» ЗАМЕНЯЕТ состав списка целиком. Если правку писали
 * от версии 5, а список ушёл к 7, принятие выкидывает всё, что появилось между ними.
 * Отказом это не делается и делаться не должно: у нас устаревшая база — `warn`, а не
 * `fail` (`suggestionChecks`), и у GitHub с Gitea пулл-реквест от старой базы тоже
 * сливается — решает человек. Но на сайте ему об этом говорят плашкой и проверкой
 * `base`, а АГЕНТУ не приходило ничего: очередь отдавала «items: 12», принятие —
 * «Accepted», и он рапортовал человеку чистый успех поверх исчезнувшей работы.
 *
 * Здесь проверяется ровно эта половина: очередь называет обе версии, а ответ принятия
 * называет, что именно было заменено, и куда смотреть дальше.
 */

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  merged: {} as Record<string, unknown>,
}))

/** Цепочка drizzle до `limit` — читающий запрос очереди собран именно так. */
const chain = () => {
  const self: Record<string, unknown> = {}
  for (const m of ['from', 'innerJoin', 'where', 'orderBy']) self[m] = () => self
  self.limit = async () => h.rows
  return self
}

vi.mock('@/shared/db', () => ({
  db: { select: () => chain() },
  steps: {},
  suggestionReportedChecks: {},
  suggestions: { id: {}, number: {}, note: {}, items: {}, createdAt: {}, baseVersion: {}, status: {}, templateId: {}, authorId: {} },
  templates: { id: {}, slug: {}, ownerId: {}, currentVersion: {} },
  users: { id: {}, handle: {} },
}))
vi.mock('@/features/library/suggestion-core', () => ({
  createSuggestion: vi.fn(),
  currentRevision: vi.fn(),
  mergeSuggestion: vi.fn(async () => h.merged),
  reviewSuggestion: vi.fn(),
  revertSuggestion: vi.fn(),
}))
vi.mock('@/features/library/suggestion-checks', () => ({ REPORTED_STATUSES: [], reportedChecks: vi.fn(async () => []) }))
vi.mock('@/shared/agents/policy', () => ({ recordAgentAction: vi.fn() }))
vi.mock('@/shared/audit', () => ({ recordAudit: vi.fn() }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))

const { mcpApplySuggestion, mcpPendingSuggestions } = await import('@/features/mcp/tools/suggestions')

const pending = (baseVersion: number, listVersion: number) => ({
  id: 's1',
  number: 7,
  note: 'правка',
  slug: 'spisok',
  items: 12,
  authorHandle: 'gость',
  createdAt: new Date('2026-09-01'),
  baseVersion,
  listVersion,
})

describe('очередь предложений называет базу правки', () => {
  it('база отстала — сказано и это, и что принятие заменит состав целиком', async () => {
    h.rows = [pending(5, 7)]
    const res = await mcpPendingSuggestions('owner')
    const s = res.suggestions[0] as Record<string, unknown>

    expect(s.basedOn).toBe(5)
    expect(s.listVersion).toBe(7)
    expect(s.staleBase).toBe(true)
    // Отказа нет и быть не должно — но следующий шаг назван.
    expect(String(s.hint)).toMatch(/get_list/)
  })

  it('база свежая — лишнего шума нет', async () => {
    h.rows = [pending(7, 7)]
    const s = (await mcpPendingSuggestions('owner')).suggestions[0] as Record<string, unknown>

    expect(s.basedOn).toBe(7)
    expect(s.staleBase).toBeUndefined()
    expect(s.hint).toBeUndefined()
  })
})

describe('ответ принятия называет, что было заменено', () => {
  it('правка от старой базы — в ответе обе версии и что делать дальше', async () => {
    h.merged = { ok: true, owner: 'owner', slug: 'spisok', kind: 'items', version: 8, baseVersion: 5, replacedVersion: 7 }
    const res = (await mcpApplySuggestion('owner', 's1')) as Record<string, unknown>

    expect(res.basedOn).toBe(5)
    expect(res.replacedVersion).toBe(7)
    expect(String(res.note), 'агент рапортовал бы человеку чистый успех').toMatch(/REPLACED/)
    expect(String(res.note)).toMatch(/patch_list/)
  })

  it('база была текущей — короткий ответ без предупреждения', async () => {
    h.merged = { ok: true, owner: 'owner', slug: 'spisok', kind: 'items', version: 8, baseVersion: 7, replacedVersion: 7 }
    const res = (await mcpApplySuggestion('owner', 's1')) as Record<string, unknown>

    expect(res.note).toBe('Accepted — a new version was created.')
    expect(res.replacedVersion).toBeUndefined()
  })

  it('веточное слияние предупреждения не носит: расхождение там разрешает git', async () => {
    h.merged = { ok: true, owner: 'owner', slug: 'spisok', kind: 'branch', version: 8 }
    const res = (await mcpApplySuggestion('owner', 's1')) as Record<string, unknown>

    expect(res.note).toBe('Accepted — a new version was created.')
  })
})
