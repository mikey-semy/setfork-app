import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ⚠️ ПРАВКА ТЕКСТА ЖИВЁТ ТОЛЬКО ВМЕСТЕ С ИСТОРИЕЙ.
 *
 * В задачах лежат жалобы и споры: без истории правка — способ переписать сказанное
 * задним числом, отредактировав обвинение после ответа на него. Так же рассудили Gitea
 * (`issue_content_history`, 20 ревизий) и GitHub (100 ревизий, видны всем с доступом
 * на чтение).
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  getSession: async () => h.session,
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${to}` })
  },
}))

const { db, users, templates, issues, issueComments, contentEdits } = await import('@/shared/db')
const { editIssue, editIssueComment, contentHistory } = await import('@/features/issues/edit-actions')

const uid: Record<string, string> = {}
let listId = ''
let issueId = ''
let commentId = ''

/** Экшены заканчиваются редиректом — это норма, а не сбой. */
const run = async (fn: () => Promise<void>) => {
  try {
    await fn()
  } catch (e) {
    if (!(e as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e
  }
}

beforeAll(async () => {
  await resetTables([users, templates, issues, issueComments, contentEdits])
  const rows = await db
    .insert(users)
    .values([{ handle: 'ed-owner' }, { handle: 'ed-author' }, { handle: 'ed-stranger' }])
    .returning({ id: users.id, handle: users.handle })
  for (const r of rows) uid[r.handle] = r.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: uid['ed-owner'], slug: 'edits', title: { en: 'Edits' }, status: 'published' })
    .returning({ id: templates.id })
  listId = tpl.id
})

beforeEach(async () => {
  await db.delete(issues).where(eq(issues.templateId, listId))
  const [iss] = await db
    .insert(issues)
    .values({ templateId: listId, number: 1, authorId: uid['ed-author'], title: 'Опечатка в шаге', body: 'Текст задачи' })
    .returning({ id: issues.id })
  issueId = iss.id
  const [c] = await db
    .insert(issueComments)
    .values({ issueId, authorId: uid['ed-author'], body: 'Первый комментарий' })
    .returning({ id: issueComments.id })
  commentId = c.id
  await db.delete(contentEdits)
})

describe('правка задачи', () => {
  it('автор правит, прежний текст уходит в историю', async () => {
    h.session = { userId: uid['ed-author'], handle: 'ed-author' }
    await run(() => editIssue('ed-owner', 'edits', 1, 'Опечатка в шаге 3', 'Уточнил номер'))

    const [iss] = await db.select().from(issues).where(eq(issues.id, issueId))
    expect(iss.title).toBe('Опечатка в шаге 3')
    expect(iss.body).toBe('Уточнил номер')

    const hist = await contentHistory('issue', issueId)
    expect(hist).toHaveLength(1)
    expect(hist[0].prevTitle, 'без прежнего текста правка — переписывание задним числом').toBe('Опечатка в шаге')
    expect(hist[0].prevBody).toBe('Текст задачи')
    expect(hist[0].editorId).toBe(uid['ed-author'])
  })

  it('владелец списка правит чужую задачу — и это тоже попадает в историю', async () => {
    h.session = { userId: uid['ed-owner'], handle: 'ed-owner' }
    await run(() => editIssue('ed-owner', 'edits', 1, 'Переформулировал', 'Текст задачи'))
    const hist = await contentHistory('issue', issueId)
    expect(hist).toHaveLength(1)
    expect(hist[0].editorId).toBe(uid['ed-owner'])
  })

  it('посторонний не правит: ни текста, ни записи в истории', async () => {
    h.session = { userId: uid['ed-stranger'], handle: 'ed-stranger' }
    await run(() => editIssue('ed-owner', 'edits', 1, 'Подмена', 'Подмена'))
    const [iss] = await db.select().from(issues).where(eq(issues.id, issueId))
    expect(iss.title).toBe('Опечатка в шаге')
    expect(await contentHistory('issue', issueId)).toHaveLength(0)
  })

  it('правка без изменений не пишет историю: иначе она заполнится пустыми ревизиями', async () => {
    h.session = { userId: uid['ed-author'], handle: 'ed-author' }
    await run(() => editIssue('ed-owner', 'edits', 1, 'Опечатка в шаге', 'Текст задачи'))
    expect(await contentHistory('issue', issueId)).toHaveLength(0)
  })

  it('пустой заголовок не сохраняется: задача без имени неотличима в списке', async () => {
    h.session = { userId: uid['ed-author'], handle: 'ed-author' }
    await run(() => editIssue('ed-owner', 'edits', 1, '   ', 'Текст'))
    const [iss] = await db.select().from(issues).where(eq(issues.id, issueId))
    expect(iss.title).toBe('Опечатка в шаге')
  })
})

describe('правка комментария', () => {
  it('автор правит свой, прежний текст уходит в историю', async () => {
    h.session = { userId: uid['ed-author'], handle: 'ed-author' }
    await run(() => editIssueComment('ed-owner', 'edits', 1, commentId, 'Уточнил формулировку'))

    const [c] = await db.select().from(issueComments).where(eq(issueComments.id, commentId))
    expect(c.body).toBe('Уточнил формулировку')
    const hist = await contentHistory('comment', commentId)
    expect(hist).toHaveLength(1)
    expect(hist[0].prevBody).toBe('Первый комментарий')
  })

  it('владелец списка НЕ правит чужой комментарий: это переписывание за человека', async () => {
    // У GitHub владелец репозитория тоже может лишь скрыть чужую реплику, а не
    // изменить её текст.
    h.session = { userId: uid['ed-owner'], handle: 'ed-owner' }
    await run(() => editIssueComment('ed-owner', 'edits', 1, commentId, 'Владелец переписал'))
    const [c] = await db.select().from(issueComments).where(eq(issueComments.id, commentId))
    expect(c.body).toBe('Первый комментарий')
    expect(await contentHistory('comment', commentId)).toHaveLength(0)
  })
})
