import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАКРЫТИЕ ОСТАВЛЯЕТ СЛЕД И ЗОВЁТ ЛЮДЕЙ.
 *
 * Раньше не делало ни того, ни другого: задача просто становилась закрытой. Автор узнавал
 * об этом, случайно вернувшись на страницу, а кто и почему закрыл — не узнавал вовсе.
 *
 * Закрытие принятой правкой к тому же не показывало, КАКОЙ именно, — хотя это первый
 * вопрос у автора: «что там поменяли-то?»
 */
const session = vi.hoisted(() => ({ userId: '', handle: 'closer', sid: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle, sid: session.sid }),
  getSession: async () => ({ userId: session.userId, handle: session.handle }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))

const { db, issueEvents, issues, notifications, suggestions, templates, users } = await import('@/shared/db')
const { setIssueStatus } = await import('@/features/issues/actions')
const { closeLinkedIssues } = await import('@/features/library/suggestion-side-effects')
const { getIssueEvents } = await import('@/features/issues/events')

let templateId = ''
let issueId = ''
let authorId = ''

beforeEach(async () => {
  await resetTables([issues, templates, users])
  const [owner] = await db.insert(users).values({ handle: session.handle }).returning({ id: users.id })
  const [author] = await db.insert(users).values({ handle: 'issue-author' }).returning({ id: users.id })
  session.userId = owner.id
  authorId = author.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: owner.id, slug: 'events-list', title: { ru: 'с' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  const [iss] = await db
    .insert(issues)
    .values({ templateId, number: 7, title: 'не работает', authorId: author.id })
    .returning({ id: issues.id })
  issueId = iss.id
})

const statusOf = async (): Promise<string> =>
  (await db.select({ s: issues.status }).from(issues).where(eq(issues.id, issueId)).limit(1))[0].s

/** Кому и какого вида ушло уведомление — парой, чтобы промах по получателю тоже ловился. */
const notified = async (): Promise<{ type: string; toAuthor: boolean }[]> =>
  (await db.select({ t: notifications.type, to: notifications.recipientId }).from(notifications)).map((r) => ({
    type: r.t,
    toAuthor: r.to === authorId,
  }))

describe('ручное закрытие', () => {
  it('пишет след в ленту и зовёт автора', async () => {
    await setIssueStatus(session.handle, 'events-list', 7, 'closed')

    expect(await statusOf()).toBe('closed')
    const events = await getIssueEvents(issueId)
    expect(events.map((e) => e.kind)).toEqual(['closed'])
    expect(events[0].actorHandle).toBe(session.handle)
    expect(await notified()).toContainEqual({ type: 'issue_closed', toAuthor: true })
  })

  it('переоткрытие — тоже событие, и прежнее не затирается', async () => {
    await setIssueStatus(session.handle, 'events-list', 7, 'closed')
    await setIssueStatus(session.handle, 'events-list', 7, 'open')

    expect(await statusOf()).toBe('open')
    // ⚠️ Лента — это история, а не текущее состояние: закрывали и открывали заново,
    // и оба следа обязаны остаться, в своём порядке.
    expect((await getIssueEvents(issueId)).map((e) => e.kind)).toEqual(['closed', 'reopened'])
    expect(await notified()).toContainEqual({ type: 'issue_reopened', toAuthor: true })
  })
})

describe('закрытие принятой правкой', () => {
  it('отмечает в ленте, какой именно правкой', async () => {
    const [sug] = await db
      .insert(suggestions)
      .values({ templateId, authorId, note: 'closes #7', baseVersion: 1, number: 3 })
      .returning({ id: suggestions.id })

    await closeLinkedIssues(templateId, 'closes #7', session.userId, true, { id: sug.id })

    expect(await statusOf()).toBe('closed')
    const [event] = await getIssueEvents(issueId)
    expect(event.kind).toBe('closed_by_suggestion')
    expect(event.suggestion, 'без ссылки автор не узнает, что именно поменяли').toEqual({ id: sug.id, number: 3 })
  })

  it('удалённая правка не уносит след закрытия', async () => {
    const [sug] = await db
      .insert(suggestions)
      .values({ templateId, authorId, note: 'closes #7', baseVersion: 1, number: 4 })
      .returning({ id: suggestions.id })
    await closeLinkedIssues(templateId, 'closes #7', session.userId, true, { id: sug.id })

    await db.delete(suggestions).where(eq(suggestions.id, sug.id))

    // Задачу ДЕЙСТВИТЕЛЬНО закрыли — событие остаётся, пропадает только ссылка.
    const [event] = await getIssueEvents(issueId)
    expect(event.kind).toBe('closed_by_suggestion')
    expect(event.suggestion).toBeNull()
  })

  it('события не считаются ответами и не находятся поиском по репликам', async () => {
    // ⚠️ Ровно тот промах, о котором предупреждает Gitea своим `type = CommentTypeComment`
    // (см. features/issues/keyword): «закрыл» в счётчике ответов и поиск по слову
    // «закрыл», возвращающий все закрытые задачи. У нас события живут отдельной таблицей,
    // поэтому промахнуться нечем — и вот проверка, что это так и осталось.
    await setIssueStatus(session.handle, 'events-list', 7, 'closed')
    const { countListIssues, getIssues } = await import('@/features/issues/queries')
    const [row] = await getIssues(templateId, { status: 'closed' }, { limit: 10 })
    expect(row.commentCount).toBe(0)
    expect(await countListIssues(templateId, { status: 'closed', q: 'закрыл' })).toBe(0)
  })

  it('событие не пишется, когда закрывать нечего', async () => {
    await closeLinkedIssues(templateId, 'просто заметка без ссылок', session.userId, true, { id: 'unused' })
    expect(await db.select({ id: issueEvents.id }).from(issueEvents)).toHaveLength(0)
  })
})
