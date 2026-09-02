import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАПЕРТОЕ ОБСУЖДЕНИЕ.
 *
 * ⚠️ ЗАПЕРТО ≠ ЗАКРЫТО. Спор уходит в сторону и при нерешённой задаче; закрывать её ради
 * тишины значит записать «сделано» там, где не сделано.
 *
 * Причина — из перечня, а не свободной строкой. У Gitea она настраивается инстансом, и её
 * же исходники называют цену (`models/issues/issue_lock.go`): «customized reasons are not
 * translatable… we do not do validation». У нас двуязычный интерфейс и узда на
 * непереводимые строки, поэтому перечень.
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
const { addIssueComment, setIssueLocked } = await import('@/features/issues/actions')
const { getIssueEvents } = await import('@/features/issues/events')

let ownerId = ''
let strangerId = ''
let issueId = ''

/** Действие уводит редиректом — для теста это «отказ», а не падение. */
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
  fd.set('owner', 'owner-user')
  fd.set('slug', 'lock-list')
  fd.set('number', '1')
  fd.set('body', body)
  return fd
}

beforeEach(async () => {
  await resetTables([issueComments, issues, templates, users])
  const [owner] = await db.insert(users).values({ handle: 'owner-user' }).returning({ id: users.id })
  const [stranger] = await db.insert(users).values({ handle: 'stranger' }).returning({ id: users.id })
  ownerId = owner.id
  strangerId = stranger.id
  session.userId = owner.id
  session.handle = 'owner-user'
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'lock-list', title: { ru: 'с' }, status: 'published' as const, visibility: 'public' as const })
    .returning({ id: templates.id })
  const [iss] = await db
    .insert(issues)
    .values({ templateId: tpl.id, number: 1, title: 'спор', authorId: stranger.id })
    .returning({ id: issues.id })
  issueId = iss.id
})

const issueRow = async () =>
  (await db.select({ lockedAt: issues.lockedAt, reason: issues.lockReason, status: issues.status }).from(issues).where(eq(issues.id, issueId)).limit(1))[0]

describe('кто запирает', () => {
  it('владелец списка — запирает с причиной и оставляет след', async () => {
    await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, true, 'too_heated'))

    const row = await issueRow()
    expect(row.lockedAt).not.toBeNull()
    expect(row.reason).toBe('too_heated')
    expect(row.status, 'запертое не становится закрытым').toBe('open')

    const [event] = await getIssueEvents(issueId)
    expect(event.kind).toBe('locked')
    expect(event.lockReason).toBe('too_heated')
  })

  it('⚠️ автор задачи запереть её НЕ может: закрыть своё — да, затыкать чужую речь — нет', async () => {
    session.userId = strangerId
    session.handle = 'stranger'
    expect(await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, true, 'spam'))).toBe('/owner-user/lock-list/issues/1')
    expect((await issueRow()).lockedAt).toBeNull()
  })

  it('повторное запирание не плодит одинаковых следов', async () => {
    await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, true, 'spam'))
    await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, true, 'off_topic'))
    expect((await getIssueEvents(issueId)).map((e) => e.kind)).toEqual(['locked'])
  })

  it('отпирание снимает причину с задачи, но НЕ из ленты', async () => {
    await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, true, 'off_topic'))
    await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, false))

    const row = await issueRow()
    expect(row.lockedAt).toBeNull()
    expect(row.reason).toBeNull()
    // «За что закрыли рот» — часть разговора, а не текущее состояние.
    const events = await getIssueEvents(issueId)
    expect(events.map((e) => e.kind)).toEqual(['locked', 'unlocked'])
    expect(events[0].lockReason).toBe('off_topic')
  })
})

describe('кто пишет в запертое', () => {
  beforeEach(() => attempt(() => setIssueLocked('owner-user', 'lock-list', 1, true, 'too_heated')))

  it('⚠️ посторонний не пройдёт и мимо формы: проверка на сервере, а не в разметке', async () => {
    session.userId = strangerId
    session.handle = 'stranger'
    // Форма спрятана, но адрес действия известен — отправить в него можно из чего угодно.
    expect(await attempt(() => addIssueComment(comment('всё равно отвечу')))).toBe('/owner-user/lock-list/issues/1')
    expect(await db.select({ id: issueComments.id }).from(issueComments)).toHaveLength(0)
  })

  it('владелец отвечает: запирание останавливает спор, а не разговор с ним', async () => {
    await attempt(() => addIssueComment(comment('итог обсуждения')))
    expect(await db.select({ id: issueComments.id }).from(issueComments)).toHaveLength(1)
  })

  it('отперли — посторонний снова может отвечать', async () => {
    await attempt(() => setIssueLocked('owner-user', 'lock-list', 1, false))
    session.userId = strangerId
    session.handle = 'stranger'
    await attempt(() => addIssueComment(comment('спасибо, что открыли')))
    expect(await db.select({ id: issueComments.id }).from(issueComments)).toHaveLength(1)
  })
})
