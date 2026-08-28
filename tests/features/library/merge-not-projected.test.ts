import { describe, expect, it, vi } from 'vitest'

/**
 * ПУСТАЯ ВЕРСИЯ У ВЕТОЧНОГО СЛИЯНИЯ — СИГНАЛ, А НЕ ОТСУТСТВИЕ.
 *
 * Ядро отдаёт `new_version = 0` (порт переводит в null) ровно тогда, когда ветку слило,
 * а проекцию в Postgres не положило: оно повторяет попытку, считает метрику и пишет
 * warn. Метрику снаружи не читает никто — сборщика в стеке нет, — так что фронт остаётся
 * единственным наблюдателем.
 *
 * Раньше это состояние было неотличимо от «принято до появления отката», и человеку
 * уходил ОТВЕТ С НЕВЕРНЫМ СОВЕТОМ: «откатывай руками» вместо «данные ещё не догнали».
 * Признак — наличие ветки: у предложения из пунктов версия пишется всегда, значит там
 * пусто действительно означает старое принятие. Дату для различения брать нельзя —
 * её пришлось бы зашить числом.
 */
const h = vi.hoisted(() => ({ sug: null as null | Record<string, unknown> }))

vi.mock('@/shared/db', () => ({
  db: { query: { suggestions: { findFirst: async () => h.sug } } },
  suggestions: {},
  templates: {},
  users: {},
  steps: {},
}))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))

const { revertSuggestion } = await import('@/features/library/suggestion-core/revert')

const accepted = (over: Record<string, unknown>) => ({
  id: 's1',
  status: 'accepted',
  mergedVersion: null,
  branchRef: null,
  template: { id: 't1', ownerId: 'owner', slug: 'spisok', currentVersion: 3 },
  ...over,
})

describe('откат при пустой версии', () => {
  it('у веточного предложения — «данные ещё не догнали», а не «откатывай руками»', async () => {
    h.sug = accepted({ branchRef: 'suggest/1' })
    const res = await revertSuggestion('owner', 's1')
    expect(res).toMatchObject({ ok: false })
    expect((res as { reason: string }).reason).toMatch(/not projected/i)
  })

  it('у предложения из пунктов — по-прежнему «принято до появления отката»', async () => {
    h.sug = accepted({ branchRef: null })
    const res = await revertSuggestion('owner', 's1')
    expect((res as { reason: string }).reason).toMatch(/by hand/i)
  })
})
