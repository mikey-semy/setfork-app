import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, embeddings, templates, users } from '@/shared/db'
import { COLUMN_DIM } from '@/shared/ai/embed-space'

// Defense-in-depth: приватные списки ИНДЕКСИРУЕМ (вектор нужен владельцу для поиска
// СВОИХ), но их плейнтекст content/metadata в корпус не пишем. embedTexts мокаем
// ненулевым вектором — проверяем РЕДАКЦИЮ хранимого текста, не качество вектора.
vi.mock('@/shared/ai/embeddings', () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map(() => new Array<number>(COLUMN_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0))),
  ),
}))

const { reindexList } = await import('@/features/library/reindex')

let ownerId = ''
let pubId = ''
let privId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${embeddings}, ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'ep-owner' }).returning({ id: users.id })
  ownerId = o.id
  const [pub] = await db
    .insert(templates)
    .values({ ownerId, slug: 'ep-pub', title: { ru: 'Публичный борщ' }, tags: ['еда'], status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  const [priv] = await db
    .insert(templates)
    .values({ ownerId, slug: 'ep-priv', title: { ru: 'Секретный маршмеллоу' }, tags: ['тайна'], status: 'published', visibility: 'private' })
    .returning({ id: templates.id })
  pubId = pub.id
  privId = priv.id
  await reindexList(pubId)
  await reindexList(privId)
})
afterAll(async () => {
  await db.execute(sql`truncate table ${embeddings}, ${templates}, ${users} restart identity cascade`)
  vi.restoreAllMocks()
})

describe('эмбеддинг-индекс: приватный плейнтекст не оседает в корпусе', () => {
  it('публичный список: content и metadata хранятся, вектор есть', async () => {
    const [row] = await db.select().from(embeddings).where(eq(embeddings.refId, pubId))
    expect(row.content).toContain('Публичный борщ')
    expect((row.metadata as Record<string, unknown>).slug).toBe('ep-pub')
    expect(row.embedding).not.toBeNull()
  })

  it('приватный список: content пуст, metadata скрыта, НО вектор сохранён', async () => {
    const rows = await db.select().from(embeddings).where(eq(embeddings.refId, privId))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.content).toBe('')
      expect(row.metadata).toEqual({ private: true })
      expect(row.embedding).not.toBeNull() // вектор для семантического поиска владельца остаётся
    }
  })

  it('плейнтекста приватного списка нет НИГДЕ в корпусе', async () => {
    const leaked = await db.select({ id: embeddings.id }).from(embeddings).where(sql`${embeddings.content} ilike '%маршмеллоу%'`)
    expect(leaked.length).toBe(0)
  })
})
