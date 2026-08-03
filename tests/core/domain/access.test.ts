import { describe, it, expect } from 'vitest'
import { canViewList, canWriteToFeature, isFeatureEnabled, type ListAccess, type ListFeatures } from '@/core/domain/access'

const list = (over: Partial<ListAccess> = {}): ListAccess => ({
  visibility: 'public',
  status: 'published',
  moderation: 'active',
  ...over,
})
const anon = { isOwner: false }
const other = { isOwner: false }
const owner = { isOwner: true }
const admin = { isOwner: false, isAdmin: true }

describe('canViewList', () => {
  it('public + published + active is visible to everyone', () => {
    expect(canViewList(list(), anon)).toBe(true)
    expect(canViewList(list(), other)).toBe(true)
    expect(canViewList(list(), owner)).toBe(true)
  })

  it('private is owner-only (admin does NOT get in)', () => {
    const l = list({ visibility: 'private' })
    expect(canViewList(l, anon)).toBe(false)
    expect(canViewList(l, other)).toBe(false)
    expect(canViewList(l, admin)).toBe(false)
    expect(canViewList(l, owner)).toBe(true)
  })

  it('draft is owner-only (admin does NOT get in)', () => {
    const l = list({ status: 'draft' })
    expect(canViewList(l, anon)).toBe(false)
    expect(canViewList(l, admin)).toBe(false)
    expect(canViewList(l, owner)).toBe(true)
  })

  it('non-active moderation is visible to owner or admin only', () => {
    for (const mod of ['flagged', 'hidden', 'pending']) {
      const l = list({ moderation: mod })
      expect(canViewList(l, anon)).toBe(false)
      expect(canViewList(l, other)).toBe(false)
      expect(canViewList(l, owner)).toBe(true)
      expect(canViewList(l, admin)).toBe(true)
    }
  })

  it('combined restrictions still deny non-owners', () => {
    const l = list({ visibility: 'private', status: 'draft', moderation: 'hidden' })
    expect(canViewList(l, anon)).toBe(false)
    expect(canViewList(l, admin)).toBe(false) // private/draft beat the admin moderation exception
    expect(canViewList(l, owner)).toBe(true)
  })

  const collab = { isOwner: false, isCollaborator: true }
  it('collaborator sees a PRIVATE list (maintained together — not kicked out)', () => {
    const l = list({ visibility: 'private' })
    expect(canViewList(l, other)).toBe(false)
    expect(canViewList(l, collab)).toBe(true)
    expect(canViewList(l, owner)).toBe(true)
  })
  it('collaborator sees a DRAFT list (helps build it)', () => {
    expect(canViewList(list({ status: 'draft' }), collab)).toBe(true)
    expect(canViewList(list({ status: 'draft' }), other)).toBe(false)
  })
  it('collaborator does NOT bypass moderation takedown (safety gate)', () => {
    for (const mod of ['flagged', 'hidden']) {
      expect(canViewList(list({ moderation: mod }), collab)).toBe(false)
    }
  })
})

// ── Разделы, выключаемые владельцем ─────────────────────────────────
// «Выключен» — решение владельца о том, что в списке НЕ ведётся, значит его
// обязана спрашивать запись. До этого предиката проверка жила только на странице,
// то есть там, где сохранённая форма её не встречает.
const withFeatures = (over: Partial<ListAccess & ListFeatures> = {}): ListAccess & ListFeatures => ({
  ...list(),
  issuesEnabled: true,
  discussionsEnabled: true,
  ...over,
})

describe('canWriteToFeature', () => {
  it('включённый раздел на видимом списке: писать можно', () => {
    expect(canWriteToFeature(withFeatures(), 'issues', other)).toBe(true)
    expect(canWriteToFeature(withFeatures(), 'discussions', other)).toBe(true)
  })

  it('выключенный раздел закрыт для записи — включая владельца', () => {
    const l = withFeatures({ discussionsEnabled: false })
    expect(canWriteToFeature(l, 'discussions', other)).toBe(false)
    // Иначе «выключено» означало бы «выключено для других».
    expect(canWriteToFeature(l, 'discussions', owner)).toBe(false)
    expect(canWriteToFeature(l, 'discussions', admin)).toBe(false)
    // Соседний раздел не задет.
    expect(canWriteToFeature(l, 'issues', other)).toBe(true)
  })

  it('включённый раздел не открывает невидимый список', () => {
    const priv = withFeatures({ visibility: 'private' })
    expect(canWriteToFeature(priv, 'issues', other)).toBe(false)
    expect(canWriteToFeature(priv, 'issues', owner)).toBe(true)
    expect(canWriteToFeature(priv, 'issues', { isOwner: false, isCollaborator: true })).toBe(true)
    // Модерационный takedown коллаборатор не обходит и здесь.
    expect(canWriteToFeature(withFeatures({ moderation: 'hidden' }), 'issues', { isOwner: false, isCollaborator: true })).toBe(false)
  })

  it('isFeatureEnabled различает разделы и не зависит от видимости', () => {
    expect(isFeatureEnabled(withFeatures({ issuesEnabled: false }), 'issues')).toBe(false)
    expect(isFeatureEnabled(withFeatures({ issuesEnabled: false }), 'discussions')).toBe(true)
    expect(isFeatureEnabled(withFeatures({ visibility: 'private' }), 'issues')).toBe(true)
  })
})
