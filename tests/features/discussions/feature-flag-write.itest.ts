import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Выключенный раздел обязан отказывать ЗАПИСИ, а не только прятать страницу.
// Сценарий отсюда — реальный: пользователь открыл форму при включённом разделе,
// владелец выключил его, пользователь отправил уже открытую форму. Страница в этот
// момент не участвует вовсе, поэтому проверять обязан server action.
//
// Мокается только граница Next-рантайма (сессия, redirect, revalidatePath) и
// уведомления. БД, guard и предикаты — настоящие.
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const e = new Error('REDIRECT') as Error & { url: string }
    e.url = url
    throw e
  },
}))
vi.mock('@/features/notifications/notify', () => ({
  notify: async () => {},
  notifyMany: async () => {},
  notifyMentions: async () => {},
}))

const { db, discussionComments, discussions, issueComments, issues, milestones, templateVersions, templates, users } = await import('@/shared/db')
const { createDiscussion, addDiscussionComment } = await import('@/features/discussions/actions')
const { createIssue, addIssueComment, setIssueStatus } = await import('@/features/issues/actions')
const { setIssueMilestone } = await import('@/features/milestones/actions')

const OWNER = 'ff-owner'
const VISITOR = 'ff-visitor'
const SLUG = 'bread'
let ownerId = ''
let visitorId = ''
let tplId = ''

/** Вызов server action: он всегда заканчивается redirect'ом — ловим его. */
const call = async (fn: () => Promise<void>): Promise<string> => {
  try {
    await fn()
    return 'no-redirect'
  } catch (e) {
    const err = e as Error & { url?: string }
    if (err.message !== 'REDIRECT') throw e
    return err.url ?? ''
  }
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const counts = async () => ({
  discussions: (await db.select().from(discussions)).length,
  discussionComments: (await db.select().from(discussionComments)).length,
  issues: (await db.select().from(issues)).length,
  issueComments: (await db.select().from(issueComments)).length,
})

const setFeatures = (patch: { issuesEnabled?: boolean; discussionsEnabled?: boolean }) =>
  db.update(templates).set(patch).where(eq(templates.id, tplId))

beforeAll(async () => {
  await db.execute(sql`truncate table ${discussionComments}, ${discussions}, ${issueComments}, ${issues}, ${milestones}, ${templateVersions}, ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [v] = await db.insert(users).values({ handle: VISITOR }).returning({ id: users.id })
  ownerId = o.id
  visitorId = v.id
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: SLUG, title: { ru: 'Хлеб' }, status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  tplId = t.id
})

beforeEach(async () => {
  h.session = { userId: visitorId, handle: VISITOR }
  await db.delete(discussionComments)
  await db.delete(discussions)
  await db.delete(issueComments)
  await db.delete(issues)
  await db.delete(milestones)
  await setFeatures({ issuesEnabled: true, discussionsEnabled: true })
})

describe('запись при выключенном разделе «Обсуждения»', () => {
  it('открытая форма нового треда после выключения раздела ничего не создаёт', async () => {
    await setFeatures({ discussionsEnabled: false })
    await call(() => createDiscussion(form({ owner: OWNER, slug: SLUG, title: 'Скрытый тред', body: 'текст' })))
    expect((await counts()).discussions).toBe(0)
  })

  it('ответ в существующий тред после выключения раздела не добавляется', async () => {
    // Тред создан, пока раздел был включён, — ответ должен отказать уже по разделу.
    await call(() => createDiscussion(form({ owner: OWNER, slug: SLUG, title: 'Тред', body: 'текст' })))
    await setFeatures({ discussionsEnabled: false })
    await call(() => addDiscussionComment(form({ owner: OWNER, slug: SLUG, number: '1', body: 'ответ' })))
    expect((await counts()).discussionComments).toBe(0)
  })

  it('владелец выключенного раздела тоже не пишет: сначала включает его обратно', async () => {
    h.session = { userId: ownerId, handle: OWNER }
    await setFeatures({ discussionsEnabled: false })
    await call(() => createDiscussion(form({ owner: OWNER, slug: SLUG, title: 'Свой тред', body: 'текст' })))
    expect((await counts()).discussions).toBe(0)
  })

  it('включённый раздел работает как раньше', async () => {
    const url = await call(() => createDiscussion(form({ owner: OWNER, slug: SLUG, title: 'Обычный тред', body: 'текст' })))
    expect(url).toBe(`/${OWNER}/${SLUG}/discussions/1`)
    expect((await counts()).discussions).toBe(1)
    await call(() => addDiscussionComment(form({ owner: OWNER, slug: SLUG, number: '1', body: 'ответ' })))
    expect((await counts()).discussionComments).toBe(1)
  })

  it('выключение одного раздела не задевает соседний', async () => {
    await setFeatures({ discussionsEnabled: false })
    await call(() => createIssue(form({ owner: OWNER, slug: SLUG, title: 'Задача', body: 'текст' })))
    expect((await counts()).issues).toBe(1)
  })
})

describe('запись при выключенном разделе «Вопросы»', () => {
  it('новая задача не заводится', async () => {
    await setFeatures({ issuesEnabled: false })
    await call(() => createIssue(form({ owner: OWNER, slug: SLUG, title: 'Скрытая задача', body: 'текст' })))
    expect((await counts()).issues).toBe(0)
  })

  it('комментарий к прежней задаче не добавляется', async () => {
    await call(() => createIssue(form({ owner: OWNER, slug: SLUG, title: 'Задача', body: 'текст' })))
    await setFeatures({ issuesEnabled: false })
    await call(() => addIssueComment(form({ owner: OWNER, slug: SLUG, number: '1', body: 'ответ' })))
    expect((await counts()).issueComments).toBe(0)
  })

  it('статус прежней задачи не меняется — это тоже запись в выключенный раздел', async () => {
    await call(() => createIssue(form({ owner: OWNER, slug: SLUG, title: 'Задача', body: 'текст' })))
    await setFeatures({ issuesEnabled: false })
    h.session = { userId: ownerId, handle: OWNER }
    await call(() => setIssueStatus(OWNER, SLUG, 1, 'closed'))
    const [iss] = await db.select({ status: issues.status }).from(issues)
    expect(iss.status).toBe('open')
  })

  it('веха задаче не назначается — это тоже запись в выключенный раздел', async () => {
    h.session = { userId: ownerId, handle: OWNER }
    await call(() => createIssue(form({ owner: OWNER, slug: SLUG, title: 'Задача', body: 'текст' })))
    const [m] = await db.insert(milestones).values({ templateId: tplId, title: 'Веха' }).returning({ id: milestones.id })
    await setFeatures({ issuesEnabled: false })
    await call(() => setIssueMilestone(OWNER, SLUG, 1, m.id))
    const [iss] = await db.select({ milestoneId: issues.milestoneId }).from(issues)
    expect(iss.milestoneId).toBeNull()
  })

  it('включённый раздел работает как раньше', async () => {
    await call(() => createIssue(form({ owner: OWNER, slug: SLUG, title: 'Задача', body: 'текст' })))
    expect((await counts()).issues).toBe(1)
    await call(() => addIssueComment(form({ owner: OWNER, slug: SLUG, number: '1', body: 'ответ' })))
    expect((await counts()).issueComments).toBe(1)
  })
})
