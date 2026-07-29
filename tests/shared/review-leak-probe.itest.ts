import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Линза 02, пункт 3 «обход владения»: КАЖДЫЙ экспорт из файла с 'use server' —
// сетевая точка входа, вызываемая с любыми аргументами (класс #542).
// getSuggestionReviews(suggestionId) не спрашивает, кто зритель: ни сессии, ни
// requireViewableMeta. Проверяем на реальной БД, что аноним получает тексты ревью
// правки к ПРИВАТНОМУ списку — и сравниваем с чокпоинтом, который такое закрывает.

// Сессии нет — ровно как у постороннего, дёрнувшего action напрямую.
vi.mock('@/shared/auth/session', () => ({ getSession: async () => null, requireSession: async () => { throw new Error('no session') } }))

const { db, templates, users, suggestions, suggestionReviews } = await import('@/shared/db')
const { getSuggestionReviews } = await import('@/features/library/review-actions')
const { requireViewableMeta } = await import('@/features/library/guard')

let sugId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [owner] = await db.insert(users).values({ handle: 'rl-owner' }).returning({ id: users.id })
  const [reviewer] = await db.insert(users).values({ handle: 'rl-reviewer' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: owner.id, slug: 'secret-list', title: { en: 'secret' }, visibility: 'private' })
    .returning({ id: templates.id })
  const [sug] = await db
    .insert(suggestions)
    .values({ templateId: tpl.id, authorId: reviewer.id, number: 1, baseVersion: 1 })
    .returning({ id: suggestions.id })
  sugId = sug.id
  await db.insert(suggestionReviews).values({
    suggestionId: sug.id,
    reviewerId: reviewer.id,
    verdict: 'changes',
    body: 'ВНУТРЕННИЙ ТЕКСТ: убери упоминание клиента X и пароль от стенда',
  })
})

describe('ревью правки к приватному списку', () => {
  it('чокпоинт чтения списка аноним не проходит', async () => {
    expect(await requireViewableMeta('rl-owner', 'secret-list')).toBeNull()
  })

  it('а getSuggestionReviews отдаёт анониму тело ревью и ник рецензента', async () => {
    const rows = await getSuggestionReviews(sugId)
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toContain('пароль от стенда')
    expect(rows[0].reviewer.handle).toBe('rl-reviewer')
  })
})
