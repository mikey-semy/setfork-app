import { describe, it, expect } from 'vitest'
import { canViewList, type ListAccess } from '@/core/domain/access'

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
