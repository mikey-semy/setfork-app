import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, embeddings, templates, users } from '@/shared/db'
import { COLUMN_DIM } from '@/shared/ai/embed-space'

// Интеграция гибридного retrieval (#377 + halfvec #380): SQL-механика на РЕАЛЬНОЙ БД —
// векторная ветка (halfvec cosine), лексическая (FTS 'simple'), RRF-слияние, вес практики,
// кап «≤2 шагов со списка», visibility. КАЧЕСТВО модели тут не меряется (см.
// scripts/eval-retrieval.ts — golden-set на живых эмбеддингах); embedOne мокается.

const mockedVec = vi.hoisted(() => ({ current: null as number[] | null }))
vi.mock('@/shared/ai/embeddings', () => ({
  embedOne: vi.fn(async () => mockedVec.current),
}))

// Детерминированные «вектора»: базисные направления → cosine 1 к своему, 0 к чужим.
const axis = (i: number) => {
  const v = new Array<number>(COLUMN_DIM).fill(0)
  v[i] = 1
  return v
}

let ownerId = ''

beforeAll(async () => {
  await resetTables([embeddings, templates, users])
  const [owner] = await db.insert(users).values({ handle: 'ret-owner' }).returning({ id: users.id })
  ownerId = owner.id

  const seed = async (slug: string, title: string, tags: string[], stars: number) => {
    const [row] = await db
      .insert(templates)
      .values({ ownerId, slug, title: { ru: title }, tags, starsCount: stars })
      .returning({ id: templates.id })
    return row.id
  }
  const borsch = await seed('borsch', 'Борщ классический', ['кулинария'], 0)
  const deploy = await seed('deploy-vps', 'Деплой на VPS', ['deploy'], 10)
  const priv = await db
    .insert(templates)
    .values({ ownerId, slug: 'secret', title: { ru: 'Секретный маршмеллоу' }, visibility: 'private' })
    .returning({ id: templates.id })

  await db.insert(embeddings).values([
    { kind: 'list', refId: borsch, content: 'Борщ классический', embedding: axis(0) },
    { kind: 'list', refId: deploy, content: 'Деплой на VPS', embedding: axis(1) },
    { kind: 'list', refId: priv[0].id, content: 'Секретный маршмеллоу', embedding: axis(0) },
    // Три шага одного списка — для капа «≤2 с одного списка».
    { kind: 'step', refId: borsch, content: 'Борщ: свёкла — запечь 40 минут', embedding: axis(0) },
    { kind: 'step', refId: borsch, content: 'Борщ: бульон — варить 2 часа', embedding: axis(0) },
    { kind: 'step', refId: borsch, content: 'Борщ: зажарка — томить 15 минут', embedding: axis(0) },
  ])
})

afterAll(async () => {
  await resetTables([embeddings, templates, users])
  vi.restoreAllMocks()
})

// import ПОСЛЕ vi.mock: retrieval получает замоканный embedOne.
import { findPrecedents } from '@/shared/ai/retrieval'
import { resetTables } from '../../helpers/reset-db'

describe('findPrecedents: гибрид на реальной БД', () => {
  it('векторная ветка: близкий вектор находит список, приватное не утекает', async () => {
    mockedVec.current = axis(0)
    const r = await findPrecedents('как сварить борщ', 'ru')
    expect(r.lists.map((l) => l.title)).toContain('Борщ классический')
    expect(r.lists.map((l) => l.title)).not.toContain('Секретный маршмеллоу')
  })

  it('кап «≤2 шагов с одного списка» держится', async () => {
    mockedVec.current = axis(0)
    const r = await findPrecedents('борщ', 'ru', { stepLimit: 5 })
    expect(r.steps.length).toBe(2)
  })

  it('лексическая ветка спасает при отключённых эмбеддингах (vec=null)', async () => {
    mockedVec.current = null
    const r = await findPrecedents('деплой VPS', 'ru')
    expect(r.lists.map((l) => l.title)).toContain('Деплой на VPS')
  })

  it('точный термин находится лексикой даже при «чужом» векторе (RRF-слияние)', async () => {
    mockedVec.current = axis(1) // вектор смотрит на деплой…
    const r = await findPrecedents('борщ', 'ru') // …а слово — про борщ
    expect(r.lists.map((l) => l.title)).toContain('Борщ классический')
  })
})
