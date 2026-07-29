import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

// ИЗОЛЯЦИЯ, путь «списки владельца» (трек tenant-isolation, путь 1 из 7).
// Метод трека: не искать дыру чтением, а закрепить поведение проверкой. Зелёная с первого
// раза — тоже результат: она держит правило от будущего дрейфа, потому что фильтр видимости
// здесь один вызов, и его легко потерять при следующей правке запроса.
const { db, templates, users } = await import('@/shared/db')
const { getUserTemplates } = await import('@/features/library/queries')

let alice = ''
let bob = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [a] = await db.insert(users).values({ handle: 'alice-iso' }).returning({ id: users.id })
  const [b] = await db.insert(users).values({ handle: 'bob-iso' }).returning({ id: users.id })
  alice = a.id
  bob = b.id
  const list = (ownerId: string, slug: string, over: Partial<typeof templates.$inferInsert> = {}) => ({
    ownerId,
    slug,
    title: { ru: slug },
    status: 'published' as const,
    visibility: 'public' as const,
    moderation: 'active' as const,
    ...over,
  })
  await db.insert(templates).values([
    list(alice, 'alice-public'),
    list(alice, 'alice-private', { visibility: 'private' }),
    list(alice, 'alice-draft', { status: 'draft' }),
  ])
})

const slugs = async (owner: string, viewer?: string) => (await getUserTemplates(owner, viewer)).map((t) => t.slug).sort()

describe('чужие списки на странице владельца', () => {
  it('аноним видит только публичное опубликованное', async () => {
    expect(await slugs(alice)).toEqual(['alice-public'])
  })

  it('ЧУЖОЙ зритель не видит ни приватного, ни черновика', async () => {
    expect(await slugs(alice, bob)).toEqual(['alice-public'])
  })

  it('сам владелец видит всё своё — иначе он не найдёт собственный черновик', async () => {
    expect(await slugs(alice, alice)).toEqual(['alice-draft', 'alice-private', 'alice-public'])
  })

  it('правило не про конкретного человека: у Боба чужого не появляется', async () => {
    expect(await slugs(bob, bob)).toEqual([])
  })
})
