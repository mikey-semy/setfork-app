import { describe, expect, it } from 'vitest'

/**
 * ЧЕКПОИНТ ПРИВАТНОСТИ №1 — правила видимости личного мира, проверенные на самих
 * предикатах, а не на глаз.
 *
 * Почему юнит-тест на предикатах, а не интеграционный на БД: правило «что видно» —
 * это чистая логика, и ошибиться в ней можно без всякой базы. Интеграционный тест на
 * живой БД нужен дополнительно (он ловит расхождение SQL и правила), но он не может
 * заменить проверку самого правила: с пустой базой он зелёный при любой логике.
 *
 * Правило (рамка NDA): публичное втекает в личную работу, личное наружу НЕ вытекает.
 */

type Scope = 'public' | 'personal'
interface List {
  ownerId: string | null
  status: 'published' | 'draft'
  visibility: 'public' | 'private'
  moderation: 'active' | 'flagged'
}

/**
 * Ровно то правило, что стоит в findPrecedents (reachable) и getRoster: публично
 * достижимое ЛИБО собственное списка зрителя — и только при scope='personal'.
 */
function reachable(list: List, viewerId: string | null, scope: Scope): boolean {
  const publiclyLive = list.status === 'published' && list.visibility === 'public' && list.moderation === 'active'
  const mine = scope === 'personal' && viewerId != null && list.ownerId === viewerId
  return publiclyLive || mine
}

/** Правило состава: общие (ownerId = null) + личные ТОЛЬКО зрителя. */
function rosterVisible(expertOwnerId: string | null, viewerId: string | null): boolean {
  return expertOwnerId === null || (viewerId != null && expertOwnerId === viewerId)
}

const ALICE = 'alice'
const BOB = 'bob'
const pub = (owner: string | null): List => ({ ownerId: owner, status: 'published', visibility: 'public', moderation: 'active' })
const priv = (owner: string | null): List => ({ ownerId: owner, status: 'published', visibility: 'private', moderation: 'active' })

describe('личный мир знаний: что достижимо в прецедентах', () => {
  it('публичное видно всем и в обоих мирах', () => {
    expect(reachable(pub(BOB), ALICE, 'public')).toBe(true)
    expect(reachable(pub(BOB), ALICE, 'personal')).toBe(true)
    expect(reachable(pub(BOB), null, 'public')).toBe(true)
  })

  it('ЧУЖОЕ приватное недостижимо ни при каком scope — это и есть утечка, если сломается', () => {
    expect(reachable(priv(BOB), ALICE, 'public')).toBe(false)
    expect(reachable(priv(BOB), ALICE, 'personal')).toBe(false)
  })

  it('своё приватное видно ТОЛЬКО в личном мире (в общем — нет)', () => {
    expect(reachable(priv(ALICE), ALICE, 'personal')).toBe(true)
    expect(reachable(priv(ALICE), ALICE, 'public')).toBe(false)
  })

  it('аноним личного мира не получает: без зрителя расширения нет', () => {
    expect(reachable(priv(ALICE), null, 'personal')).toBe(false)
  })

  it('черновик и снятое модерацией не «отмываются» личным миром чужого', () => {
    expect(reachable({ ...pub(BOB), status: 'draft' }, ALICE, 'personal')).toBe(false)
    expect(reachable({ ...pub(BOB), moderation: 'flagged' }, ALICE, 'personal')).toBe(false)
    // А вот СВОЙ черновик в личном мире достижим — это работа владельца над своим.
    expect(reachable({ ...pub(ALICE), status: 'draft' }, ALICE, 'personal')).toBe(true)
  })
})

describe('состав специалистов: общие + только свои личные', () => {
  it('общий специалист (ownerId = null) виден всем, включая анонима', () => {
    expect(rosterVisible(null, ALICE)).toBe(true)
    expect(rosterVisible(null, null)).toBe(true)
  })

  it('ЧУЖОЙ личный специалист не виден — иначе он попал бы в чужой совет', () => {
    expect(rosterVisible(BOB, ALICE)).toBe(false)
  })

  it('свой личный виден владельцу', () => {
    expect(rosterVisible(ALICE, ALICE)).toBe(true)
  })

  it('без зрителя личных не отдаём вовсе: фоновые петли работают общим составом', () => {
    expect(rosterVisible(ALICE, null)).toBe(false)
  })
})
