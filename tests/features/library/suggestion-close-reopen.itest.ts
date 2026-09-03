import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * КТО ЗАКРЫВАЕТ И ПЕРЕОТКРЫВАЕТ ПРЕДЛОЖЕНИЕ.
 *
 * Решение владельца (03.09.2026): «давай реализуем как это принято в других проектах».
 * Форма взята по исходникам, а не по памяти:
 *  • Gitea, `routers/web/repo/issue_comment.go`: право — `CanWriteIssuesOrPulls(...) ||
 *    issue.IsPoster(doer)`, причём ОДНО на задачи и правки (у неё одна таблица), и там же
 *    граница переоткрытия: `!(issue.IsPull && issue.PullRequest.HasMerged)`;
 *  • GitLab, `app/policies/issuable_policy.rb`: `assignee_or_author` получает
 *    `update_merge_request` и `reopen_merge_request`.
 *
 * ⚠️ Принятое не переоткрывается НИКЕМ: оно уже в main, и «открыть заново» означало бы,
 * что его можно слить второй раз. Возврат у нас — отдельное действие, делающее новое
 * предложение.
 */
const session = vi.hoisted(() => ({ userId: '', handle: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle }),
  getSession: async () => ({ userId: session.userId, handle: session.handle }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({ redirect: () => {} }))

const { db, suggestions, templates, users } = await import('@/shared/db')
const { rejectSuggestion, reopenSuggestion } = await import('@/features/library/actions/suggestion-submit')

let sugId = ''
const ids = { owner: '', author: '', stranger: '' }

const statusOf = async (): Promise<string> =>
  (await db.select({ s: suggestions.status }).from(suggestions).where(eq(suggestions.id, sugId)).limit(1))[0].s

const as = (who: keyof typeof ids) => {
  session.userId = ids[who]
  session.handle = who
}

const setStatus = (status: 'open' | 'rejected' | 'accepted') =>
  db.update(suggestions).set({ status, resolvedAt: status === 'open' ? null : new Date() }).where(eq(suggestions.id, sugId))

beforeEach(async () => {
  await resetTables([suggestions, templates, users])
  const [owner] = await db.insert(users).values({ handle: 'owner' }).returning({ id: users.id })
  const [author] = await db.insert(users).values({ handle: 'author' }).returning({ id: users.id })
  const [stranger] = await db.insert(users).values({ handle: 'stranger' }).returning({ id: users.id })
  Object.assign(ids, { owner: owner.id, author: author.id, stranger: stranger.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: owner.id, slug: 'pr-rights', title: { ru: 'с' }, status: 'published' as const, visibility: 'public' as const })
    .returning({ id: templates.id })
  const [sug] = await db
    .insert(suggestions)
    .values({ templateId: tpl.id, authorId: author.id, note: 'правка', baseVersion: 1, number: 3 })
    .returning({ id: suggestions.id })
  sugId = sug.id
  as('owner')
})

describe('закрытие', () => {
  it('⚠️ автор закрывает СВОЁ — раньше не мог, хотя свою задачу закрывает', async () => {
    as('author')
    await rejectSuggestion(sugId)
    expect(await statusOf()).toBe('rejected')
  })

  it('владелец списка закрывает чужое', async () => {
    await rejectSuggestion(sugId)
    expect(await statusOf()).toBe('rejected')
  })

  it('посторонний не закрывает ничего', async () => {
    as('stranger')
    await rejectSuggestion(sugId)
    expect(await statusOf()).toBe('open')
  })
})

describe('переоткрытие', () => {
  it('отклонённое открывается заново — и автором, и владельцем', async () => {
    await setStatus('rejected')
    as('author')
    await reopenSuggestion(sugId)
    expect(await statusOf()).toBe('open')

    await setStatus('rejected')
    as('owner')
    await reopenSuggestion(sugId)
    expect(await statusOf()).toBe('open')
  })

  it('⚠️ ПРИНЯТОЕ не открывается никем: оно уже в main', async () => {
    await setStatus('accepted')
    for (const who of ['author', 'owner'] as const) {
      as(who)
      await reopenSuggestion(sugId)
      expect(await statusOf(), `${who} не должен уметь переоткрыть слитое`).toBe('accepted')
    }
  })

  it('посторонний не переоткрывает', async () => {
    await setStatus('rejected')
    as('stranger')
    await reopenSuggestion(sugId)
    expect(await statusOf()).toBe('rejected')
  })

  it('переоткрытое снова открыто: отметка о разрешении снимается', async () => {
    await setStatus('rejected')
    as('author')
    await reopenSuggestion(sugId)
    const [row] = await db.select({ at: suggestions.resolvedAt }).from(suggestions).where(eq(suggestions.id, sugId)).limit(1)
    // Иначе список «закрытых» считал бы его закрытым, а страница показывала открытым.
    expect(row.at).toBeNull()
  })

  it('запертое обсуждение переоткрытию не мешает: замок про речь, а не про состояние', async () => {
    // Так же у обоих: GitLab запрещает замком `create_note`, Gitea — «limit commenting».
    await db.update(suggestions).set({ lockedAt: new Date(), lockedById: ids.owner }).where(eq(suggestions.id, sugId))
    await setStatus('rejected')
    as('author')
    await reopenSuggestion(sugId)
    expect(await statusOf()).toBe('open')
  })
})
