import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Линза 02, F2: тексты ревью правок к ПРИВАТНОМУ списку читались без входа.
// Чтение жило в файле с 'use server', то есть каждый экспорт — сетевая точка входа,
// вызываемая с любым id правки (класс #542), и гейта зрителя внутри не было.
// Проверяем на реальной БД: чокпоинт списка и чтение ревью отвечают одинаково.

vi.mock('@/shared/auth/session', () => ({
  getSession: async () => null,
  requireSession: async () => {
    throw new Error('no session')
  },
}))

const { db, templates, users, suggestions, suggestionReviews, collaborators } = await import('@/shared/db')
const { getSuggestionReviews, hasBlockingReview, countApprovals } = await import('@/features/library/review-queries')
const { requireViewableMeta } = await import('@/features/library/guard')

const SECRET = 'ВНУТРЕННИЙ ТЕКСТ: убери упоминание клиента X и пароль от стенда'
const uid: Record<string, string> = {}
const sug: Record<string, string> = {}

async function seedList(slug: string, over: Record<string, unknown>): Promise<string> {
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: slug }, ...over })
    .returning({ id: templates.id })
  const [s] = await db
    .insert(suggestions)
    .values({ templateId: tpl.id, authorId: uid.author, number: 1, baseVersion: 1 })
    .returning({ id: suggestions.id })
  await db.insert(suggestionReviews).values({
    suggestionId: s.id,
    reviewerId: uid.reviewer,
    verdict: 'changes',
    body: SECRET,
  })
  sug[slug] = s.id
  return tpl.id
}

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  for (const k of ['owner', 'author', 'reviewer', 'stranger', 'collab']) {
    const [u] = await db.insert(users).values({ handle: `rv-${k}` }).returning({ id: users.id })
    uid[k] = u.id
  }
  const privId = await seedList('secret-list', { visibility: 'private' })
  await db.insert(collaborators).values({ templateId: privId, userId: uid.collab })
  await seedList('draft-list', { status: 'draft' })
  await seedList('open-list', {})
}, 60_000)

describe('ревью правки к приватному списку', () => {
  it('чокпоинт чтения списка аноним не проходит', async () => {
    expect(await requireViewableMeta('rv-owner', 'secret-list')).toBeNull()
  })

  it('и чтение ревью анониму не отдаёт ни текста, ни ника рецензента', async () => {
    const rows = await getSuggestionReviews(sug['secret-list'])
    expect(rows).toHaveLength(0)
    expect(JSON.stringify(rows)).not.toContain('пароль от стенда')
  })

  it('постороннему — тоже ничего (id правки знать недостаточно)', async () => {
    expect(await getSuggestionReviews(sug['secret-list'], uid.stranger)).toHaveLength(0)
  })

  it('владелец и коллаборатор переписку видят', async () => {
    for (const who of ['owner', 'collab'] as const) {
      const rows = await getSuggestionReviews(sug['secret-list'], uid[who])
      expect(rows, who).toHaveLength(1)
      expect(rows[0].body).toContain('пароль от стенда')
      expect(rows[0].reviewer.handle).toBe('rv-reviewer')
    }
  })

  it('правило одно на список: автор правки без доступа к приватному списку тоже не читает', async () => {
    // Так и на самой странице правки — она гейтится видимостью списка. Случай
    // реальный: список был публичным, посторонний предложил правку, владелец закрыл.
    expect(await getSuggestionReviews(sug['secret-list'], uid.author)).toHaveLength(0)
  })

  it('черновик закрыт так же, а публичный список открыт всем', async () => {
    expect(await getSuggestionReviews(sug['draft-list'])).toHaveLength(0)
    expect(await getSuggestionReviews(sug['draft-list'], uid.owner)).toHaveLength(1)
    expect(await getSuggestionReviews(sug['open-list'])).toHaveLength(1)
  })
})

describe('гейты слияния гейт зрителя не задевает', () => {
  it('«просит доработать» и счёт одобрений считаются и на приватном списке', async () => {
    // Гейты зовут внутреннего чтеца, а не поверхность для зрителя: иначе правка к
    // приватному списку сливалась бы мимо блокирующего вердикта.
    // Голос постороннего рецензента — совет, а не стоп-кран.
    expect(await hasBlockingReview(sug['secret-list'])).toBe(false)
    expect(await countApprovals(sug['secret-list'])).toBe(0)

    await db.insert(suggestionReviews).values({
      suggestionId: sug['secret-list'],
      reviewerId: uid.collab,
      verdict: 'changes',
      body: 'коллаборатор просит доработать',
    })
    expect(await hasBlockingReview(sug['secret-list'])).toBe(true)

    await db.insert(suggestionReviews).values({
      suggestionId: sug['secret-list'],
      reviewerId: uid.owner,
      verdict: 'approve',
      body: 'ок',
    })
    expect(await countApprovals(sug['secret-list'])).toBe(1)
  })
})
