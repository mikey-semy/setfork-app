import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАПЕРТОЕ ОБСУЖДЕНИЕ ПРАВКИ ОТВЕЧАЕТ ОТКАЗОМ, А НЕ ТИШИНОЙ.
 *
 * ⚠️ Здесь было хуже, чем в задачах. Там форма ответа исчезала, и человек хотя бы видел,
 * что писать нельзя. Тут форма оставалась на месте, кнопка нажималась, реплика пропадала:
 * экшен делал голый `return`. Вывод у человека один — «сломался сайт», а не «мне
 * запретили писать».
 */
const session = vi.hoisted(() => ({ userId: '', handle: 'owner-user' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle }),
  getSession: async () => ({ userId: session.userId, handle: session.handle }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { redirectTo: to })
  },
}))

const { db, suggestionComments, suggestions, templates, users } = await import('@/shared/db')
const { addSuggestionComment } = await import('@/features/library/actions/suggestion-comments')
const { setSuggestionLocked } = await import('@/features/library/suggestion-meta-actions')

let sugId = ''
let strangerId = ''

const attempt = async (fn: () => Promise<unknown>): Promise<string | 'ok'> => {
  try {
    await fn()
    return 'ok'
  } catch (e) {
    const to = (e as { redirectTo?: string }).redirectTo
    if (to) return to
    throw e
  }
}

const comment = (body: string) => {
  const fd = new FormData()
  fd.set('suggestionId', sugId)
  fd.set('body', body)
  return fd
}

const replies = async (): Promise<number> => (await db.select({ id: suggestionComments.id }).from(suggestionComments)).length

beforeEach(async () => {
  await resetTables([suggestionComments, suggestions, templates, users])
  const [owner] = await db.insert(users).values({ handle: 'owner-user' }).returning({ id: users.id })
  const [stranger] = await db.insert(users).values({ handle: 'stranger' }).returning({ id: users.id })
  session.userId = owner.id
  session.handle = 'owner-user'
  strangerId = stranger.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: owner.id, slug: 'lock-pr', title: { ru: 'с' }, status: 'published' as const, visibility: 'public' as const })
    .returning({ id: templates.id })
  const [sug] = await db
    .insert(suggestions)
    .values({ templateId: tpl.id, authorId: stranger.id, note: 'правка', baseVersion: 1, number: 5 })
    .returning({ id: suggestions.id })
  sugId = sug.id
})

describe('замок у правки', () => {
  it('вешается с причиной, как у задач', async () => {
    await setSuggestionLocked(sugId, true, 'too_heated')
    const [row] = await db.select({ at: suggestions.lockedAt, reason: suggestions.lockReason, status: suggestions.status }).from(suggestions).where(eq(suggestions.id, sugId))
    expect(row.at).not.toBeNull()
    expect(row.reason).toBe('too_heated')
    expect(row.status, 'заперто ≠ закрыто').toBe('open')
  })

  it('⚠️ ответ в запертое отклоняется ВСЛУХ, а не молча', async () => {
    await setSuggestionLocked(sugId, true, 'spam')
    session.userId = strangerId
    session.handle = 'stranger'

    // Раньше здесь возвращался `undefined` («ok»), реплика пропадала без следа.
    const where = await attempt(() => addSuggestionComment(comment('всё равно отвечу')))
    expect(where, 'человек обязан получить объяснение, а не тишину').toContain('?e=locked')
    expect(await replies()).toBe(0)
  })

  it('⚠️ ведущий раздел отвечать МОЖЕТ — замок останавливает спор, а не разговор с владельцем', async () => {
    // Выровнено с задачами и с обоими проектами: Gitea — «limit commenting abilities to
    // users with write access», GitLab — `rule { locked & ~is_container_member }
    // .policy do prevent :create_note`. Раньше у правок замок молчал для всех, включая
    // владельца: три разных ответа на один вопрос внутри одного продукта.
    await setSuggestionLocked(sugId, true, 'resolved')
    await attempt(() => addSuggestionComment(comment('итог обсуждения')))
    expect(await replies()).toBe(1)
  })

  it('отперли — причина снимается, ответы снова идут', async () => {
    await setSuggestionLocked(sugId, true, 'off_topic')
    await setSuggestionLocked(sugId, false)
    const [row] = await db.select({ at: suggestions.lockedAt, reason: suggestions.lockReason }).from(suggestions).where(eq(suggestions.id, sugId))
    expect(row.at).toBeNull()
    expect(row.reason).toBeNull()

    await attempt(() => addSuggestionComment(comment('спасибо, что открыли')))
    expect(await replies()).toBe(1)
  })
})
