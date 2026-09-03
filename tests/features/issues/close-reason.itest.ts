import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЧЕМ КОНЧИЛАСЬ ЗАДАЧА — ОТДЕЛЬНО ОТ ТОГО, ОТКРЫТА ЛИ ОНА.
 *
 * «Сделано» и «не будем делать» выглядят одинаково — перечёркнутым номером, — а значат
 * противоположное. Разделение статуса и исхода есть у всех, кого читали: GitHub
 * (`IssueStateReason`: COMPLETED, NOT_PLANNED, DUPLICATE, REOPENED — интроспекция его же
 * схемы), SourceHut (`TicketStatus` + `TicketResolution`, исход обязателен при RESOLVED),
 * Jira («statuses indicate where work stands; resolutions explain how»).
 */
const session = vi.hoisted(() => ({ userId: '', handle: 'owner-user', sid: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle, sid: session.sid }),
  getSession: async () => ({ userId: session.userId, handle: session.handle }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { redirectTo: to })
  },
}))

const { db, issueComments, issues, templates, users } = await import('@/shared/db')
const { setIssueStatus } = await import('@/features/issues/actions')
const { getIssueEvents } = await import('@/features/issues/events')
const { getIssues } = await import('@/features/issues/queries')
const { closeLinkedIssues } = await import('@/features/library/suggestion-side-effects')

let templateId = ''
let issueId = ''
let originalId = ''

const attempt = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch (e) {
    if (!(e as { redirectTo?: string }).redirectTo) throw e
  }
}

const row = async (id = issueId) =>
  (await db
    .select({ status: issues.status, reason: issues.closeReason, dup: issues.duplicateOfId })
    .from(issues)
    .where(eq(issues.id, id))
    .limit(1))[0]

beforeEach(async () => {
  await resetTables([issueComments, issues, templates, users])
  const [u] = await db.insert(users).values({ handle: 'owner-user' }).returning({ id: users.id })
  session.userId = u.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'reason-list', title: { ru: 'с' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  const rows = await db
    .insert(issues)
    .values([
      { templateId, number: 1, title: 'дубль', authorId: u.id },
      { templateId, number: 2, title: 'оригинал', authorId: u.id },
    ])
    .returning({ id: issues.id, number: issues.number })
  issueId = rows.find((r) => r.number === 1)!.id
  originalId = rows.find((r) => r.number === 2)!.id
})

describe('исход закрытия', () => {
  it('«сделано» и «не будем делать» — разные исходы при одном статусе', async () => {
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'closed', 'completed'))
    expect(await row()).toMatchObject({ status: 'closed', reason: 'completed' })

    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'open'))
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'closed', 'not_planned'))
    expect(await row()).toMatchObject({ status: 'closed', reason: 'not_planned' })
  })

  it('⚠️ дубликат — это исход И ссылка: причина без оригинала не говорит, где он', async () => {
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'closed', 'duplicate', 2))
    expect(await row()).toMatchObject({ status: 'closed', reason: 'duplicate', dup: originalId })

    const [event] = await getIssueEvents(issueId)
    expect(event.closeReason).toBe('duplicate')
    expect(event.duplicate).toEqual({ id: originalId, number: 2 })
  })

  it('дубликатом самой себя задача не объявляется', async () => {
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'closed', 'duplicate', 1))
    expect((await row()).dup, 'ссылка на себя — это не ссылка').toBeNull()
  })

  it('переоткрытие снимает исход с задачи, но НЕ из ленты', async () => {
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'closed', 'not_planned'))
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'open'))

    expect(await row()).toMatchObject({ status: 'open', reason: null })
    // «Закрыли как не будем делать» — часть разговора, а не текущее состояние.
    const events = await getIssueEvents(issueId)
    expect(events.map((e) => e.kind)).toEqual(['closed', 'reopened'])
    expect(events[0].closeReason).toBe('not_planned')
  })

  it('⚠️ закрытие принятой правкой ставит «сделано», а не оставляет пусто', async () => {
    // Иначе у самого частого способа закрытия исход был бы пустым навсегда.
    await closeLinkedIssues(templateId, 'closes #1', session.userId, true, { id: undefined as unknown as string })
    expect(await row()).toMatchObject({ status: 'closed', reason: 'completed' })
  })
})

describe('фильтр по исходу', () => {
  it('отбирает закрытые по тому, чем они кончились', async () => {
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 1, 'closed', 'not_planned'))
    await attempt(() => setIssueStatus('owner-user', 'reason-list', 2, 'closed', 'completed'))

    const nums = async (reason?: 'completed' | 'not_planned' | 'duplicate') =>
      (await getIssues(templateId, { status: 'closed', closeReason: reason }, { limit: 50 })).map((r) => r.number)

    expect(await nums('completed')).toEqual([2])
    expect(await nums('not_planned')).toEqual([1])
    expect((await nums()).sort()).toEqual([1, 2])
  })
})
