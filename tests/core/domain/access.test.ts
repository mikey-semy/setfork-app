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

describe('черновик и админ', () => {
  const draft = (extra: Partial<Parameters<typeof canViewList>[0]> = {}) =>
    ({ visibility: 'public', status: 'draft', moderation: 'active', ...extra }) as Parameters<typeof canViewList>[0]
  const admin = { isOwner: false, isAdmin: true }
  const stranger = { isOwner: false, isAdmin: false }

  it('черновик ЧЕЛОВЕКА админу закрыт — это личная запись, а не работа компании', () => {
    expect(canViewList(draft(), admin)).toBe(false)
    expect(canViewList(draft(), stranger)).toBe(false)
    expect(canViewList(draft(), { isOwner: true })).toBe(true)
  })

  it('черновик СЛУЖЕБНОГО аккаунта админу открыт: иначе его не видит никто', () => {
    // Гном в браузер не заходит, а для всех остальных черновик закрыт. До 27.08.2026
    // это значило, что петля самогенерации производит контент, который нельзя ни
    // увидеть, ни опубликовать руками: всё, что придержал шлюз готовности, оставалось
    // невидимым навсегда. Найдено владельцем рассуждением, а не по симптому.
    expect(canViewList(draft({ ownerIsAgent: true }), admin)).toBe(true)
    // Не-админу служебный черновик по-прежнему закрыт: право даёт разбор, а не публичность.
    expect(canViewList(draft({ ownerIsAgent: true }), stranger)).toBe(false)
  })

  it('черновик ПОД МОДЕРАЦИЕЙ админу открыт: очередь зовёт его разобрать', () => {
    // Очередь отбирает по состоянию модерации, не глядя на статус, поэтому черновик с
    // `pending` в неё попадает. Раньше по ссылке приходил 404 — очередь звала разобрать
    // то, что сама же не давала открыть («ни одну статью открыть невозможно»).
    expect(canViewList(draft({ moderation: 'pending' }), admin)).toBe(true)
    expect(canViewList(draft({ moderation: 'hidden' }), admin)).toBe(true)
    expect(canViewList(draft({ moderation: 'pending' }), stranger)).toBe(false)
  })

  it('ПРИВАТНОСТЬ не расширена ни одним из двух случаев', () => {
    // Правило про приватное стоит раньше и отдельно: ни служебный автор, ни очередь
    // модерации не открывают админу приватный список.
    expect(canViewList(draft({ visibility: 'private', ownerIsAgent: true }), admin)).toBe(false)
    expect(canViewList(draft({ visibility: 'private', moderation: 'pending' }), admin)).toBe(false)
  })
})
