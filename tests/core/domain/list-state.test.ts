import { describe, expect, it } from 'vitest'
import { canEditList, canRunList, editBlockReason, isArchived, isFrozen } from '@/core'

describe('list state (archive / freeze)', () => {
  const open = { archivedAt: null, frozenAt: null }
  const frozen = { archivedAt: null, frozenAt: new Date() }
  const archived = { archivedAt: new Date(), frozenAt: null }

  it('isArchived / isFrozen по наличию таймстампа', () => {
    expect(isArchived(open)).toBe(false)
    expect(isArchived(archived)).toBe(true)
    expect(isFrozen(open)).toBe(false)
    expect(isFrozen(frozen)).toBe(true)
  })

  it('canEditList: правки запрещены и в архиве, и в заморозке', () => {
    expect(canEditList(open)).toBe(true)
    expect(canEditList(frozen)).toBe(false)
    expect(canEditList(archived)).toBe(false)
  })

  it('canRunList: прогоны запрещены ТОЛЬКО в архиве (заморозка их оставляет)', () => {
    expect(canRunList(open)).toBe(true)
    expect(canRunList(frozen)).toBe(true) // ключевое отличие заморозки от архива
    expect(canRunList(archived)).toBe(false)
  })

  it('editBlockReason: архив приоритетнее заморозки', () => {
    expect(editBlockReason(open)).toBeNull()
    expect(editBlockReason(frozen)).toBe('frozen')
    expect(editBlockReason(archived)).toBe('archived')
    expect(editBlockReason({ archivedAt: new Date(), frozenAt: new Date() })).toBe('archived')
  })

  it('строковый таймстамп (из JSON) тоже считается состоянием', () => {
    expect(isArchived({ archivedAt: '2026-07-22T00:00:00Z' })).toBe(true)
  })
})
