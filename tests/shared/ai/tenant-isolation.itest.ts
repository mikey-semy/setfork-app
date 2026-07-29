import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { COLUMN_DIM } from '@/shared/ai/embed-space'

/**
 * ЧЕКПОИНТ ПРИВАТНОСТИ №1, вторая половина: правило проверено на РЕАЛЬНОМ SQL.
 *
 * Юнит-тест (personal-scope.test.ts) проверяет само правило и прямо говорит, что не может
 * заменить проверку запроса: с пустой базой он зелёный при любой логике. Здесь наоборот —
 * матрица «кто что видит» гоняется по живым данным, потому что утечка личного мира это не
 * баг ранжирования, а нарушение обещания.
 *
 * Рамка (NDA): публичное втекает в личную работу, личное наружу НЕ вытекает.
 */
const mockedVec = vi.hoisted(() => ({ current: null as number[] | null }))
vi.mock('@/shared/ai/embeddings', () => ({ embedOne: vi.fn(async () => mockedVec.current) }))

const { db, embeddings, councilExperts, templates, users } = await import('@/shared/db')
const { findPrecedents } = await import('@/shared/ai/retrieval')
const { getRoster } = await import('@/shared/ai/roster')

const axis = (i: number) => {
  const v = new Array<number>(COLUMN_DIM).fill(0)
  v[i] = 1
  return v
}

let alice = ''
let bob = ''

const seedList = async (ownerId: string, slug: string, title: string, over: Partial<typeof templates.$inferInsert> = {}) => {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { ru: title }, tags: ['кулинария'], ...over })
    .returning({ id: templates.id })
  await db.insert(embeddings).values({ kind: 'list', refId: row.id, content: title, embedding: axis(0) })
  return row.id
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${embeddings}, ${councilExperts}, ${templates}, ${users} restart identity cascade`)
  const [a] = await db.insert(users).values({ handle: 'alice' }).returning({ id: users.id })
  const [b] = await db.insert(users).values({ handle: 'bob' }).returning({ id: users.id })
  alice = a.id
  bob = b.id

  await seedList(alice, 'public-borsch', 'Борщ на всех')
  await seedList(alice, 'alice-secret', 'Секретный борщ Алисы', { visibility: 'private' })
  await seedList(bob, 'bob-secret', 'Секретный борщ Боба', { visibility: 'private' })
  await seedList(bob, 'bob-draft', 'Черновик Боба', { status: 'draft' })
  // Свой список, снятый модерацией: в личный мир он попадать НЕ должен — прецеденты
  // уезжают в промпт, и недопустимый материал расползался бы по новым спискам.
  await seedList(alice, 'alice-flagged', 'Снятый борщ Алисы', { moderation: 'flagged' })
  await seedList(alice, 'alice-hidden', 'Скрытый борщ Алисы', { moderation: 'hidden' })

  // Специалисты: общий (ownerId=null), личный Алисы, личный Боба.
  const base = { persona: 'p', code: '', lens: '', domains: ['кулинария'], model: '', avatar: 'generalist', online: false, enabled: true, sort: 1 }
  await db.insert(councilExperts).values([
    { id: 'common-cook', nameEn: 'Common', nameRu: 'Общий', guildEn: 'g', guildRu: 'г', ownerId: null, ...base },
    { id: 'alice-cook', nameEn: 'AliceCook', nameRu: 'ПоварАлисы', guildEn: 'g', guildRu: 'г', ownerId: alice, ...base },
    { id: 'bob-cook', nameEn: 'BobCook', nameRu: 'ПоварБоба', guildEn: 'g', guildRu: 'г', ownerId: bob, ...base },
  ])
  mockedVec.current = axis(0)
})

const titlesFor = async (viewer: string | null, scope: 'public' | 'personal') =>
  (await findPrecedents('борщ', 'ru', { userId: viewer, scope, limit: 10 })).lists.map((l) => l.title).sort()

describe('матрица: чей мир видно в прецедентах', () => {
  it('общая шахта — только публичное, даже своё приватное не подмешивается', async () => {
    expect(await titlesFor(alice, 'public')).toEqual(['Борщ на всех'])
  })

  it('личный мир Алисы — публичное ПЛЮС её собственное', async () => {
    expect(await titlesFor(alice, 'personal')).toEqual(['Борщ на всех', 'Секретный борщ Алисы'])
  })

  it('своё, снятое модерацией, в личный мир НЕ подмешивается', async () => {
    // Вердикт модерации — не про видимость, а про то, что этому не место в работе:
    // прецедент уезжает в промпт модели и расползается по новым спискам.
    const mine = await titlesFor(alice, 'personal')
    expect(mine).not.toContain('Снятый борщ Алисы')
    expect(mine).not.toContain('Скрытый борщ Алисы')
  })

  it('ЧУЖОЙ мир не виден: у Боба нет списков Алисы ни при каком scope', async () => {
    const bobPersonal = await titlesFor(bob, 'personal')
    expect(bobPersonal).not.toContain('Секретный борщ Алисы')
    expect(bobPersonal).toContain('Секретный борщ Боба')
  })

  it('аноним видит только публичное', async () => {
    expect(await titlesFor(null, 'personal')).toEqual(['Борщ на всех'])
  })

  it('черновик остаётся личным даже у своего владельца в общей шахте', async () => {
    expect(await titlesFor(bob, 'public')).toEqual(['Борщ на всех'])
    expect(await titlesFor(bob, 'personal')).toContain('Черновик Боба')
  })
})

describe('матрица: чьи специалисты видны', () => {
  it('без зрителя — только общие', async () => {
    const ids = (await getRoster()).map((e) => e.id)
    expect(ids).toContain('common-cook')
    expect(ids).not.toContain('alice-cook')
    expect(ids).not.toContain('bob-cook')
  })

  it('зритель видит общих и СВОИХ, но не чужих', async () => {
    const ids = (await getRoster(alice)).map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['common-cook', 'alice-cook']))
    expect(ids).not.toContain('bob-cook')
  })

  it('симметрично для другого зрителя — правило не про конкретного человека', async () => {
    const ids = (await getRoster(bob)).map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['common-cook', 'bob-cook']))
    expect(ids).not.toContain('alice-cook')
  })
})
