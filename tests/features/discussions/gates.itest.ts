import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ВОРОТА ОБСУЖДЕНИЙ: КТО ПИШЕТ И КАК ЧАСТО.
 *
 * Раздел жил без обоих:
 *
 *  • ⚠️ СОАВТОР ПРИВАТНОГО СПИСКА ЧИТАЛ, НО НЕ ПИСАЛ. Право спрашивали только у
 *    владельца, поэтому соавтор оказывался в положении, которое не выражает ничего
 *    осмысленного: вкладка открыта, форма на месте, запись отклоняется. Список ведут
 *    вместе — а разговаривать о нём разрешено одному. Тот же перекос уже чинили у
 *    задач (#582), здесь он остался.
 *  • СЧЁТЧИКА ЧАСТОТЫ НЕ БЫЛО ВОВСЕ: скрипт в цикле набивал ленту за минуту.
 *
 * Мокается только граница Next-рантайма и уведомления; БД, права и пороги настоящие.
 */
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

const { db, collaborators, discussionComments, discussions, templates, users } = await import('@/shared/db')
const { createDiscussion, addDiscussionComment } = await import('@/features/discussions/actions')
const { DISCUSSION_LIMITS } = await import('@/features/discussions/limits')

const OWNER = 'dg-owner'
const SLUG = 'private-list'
let ownerId = ''
let collabId = ''
let strangerId = ''
let tplId = ''

const call = async (fn: () => Promise<unknown>): Promise<string> => {
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

const openThread = (title: string) => call(() => createDiscussion(null, form({ owner: OWNER, slug: SLUG, title, body: 'текст' })))
const threadCount = async () => (await db.select().from(discussions)).length

beforeEach(async () => {
  await resetTables([discussionComments, discussions, collaborators, templates, users])
  const rows = await db
    .insert(users)
    .values([{ handle: OWNER }, { handle: 'dg-collab' }, { handle: 'dg-stranger' }])
    .returning({ id: users.id, handle: users.handle })
  const byHandle = (handle: string) => {
    const row = rows.find((r) => r.handle === handle)
    if (!row) throw new Error(`не завёлся пользователь ${handle}`)
    return row.id
  }
  ownerId = byHandle(OWNER)
  collabId = byHandle('dg-collab')
  strangerId = byHandle('dg-stranger')

  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: SLUG, title: { en: 'Private list' }, visibility: 'private', status: 'published' })
    .returning({ id: templates.id })
  tplId = tpl.id
  await db.insert(collaborators).values({ templateId: tplId, userId: collabId })
  h.session = { userId: collabId, handle: 'dg-collab' }
})

describe('кто вправе говорить в приватном списке', () => {
  it('⚠️ СОАВТОР начинает тред и отвечает в нём — список ведут вместе', async () => {
    const url = await openThread('вопрос по шагу 3')
    expect(url, 'соавтора уводило на страницу списка, будто списка он не видит').toBe(`/${OWNER}/${SLUG}/discussions/1`)
    expect(await threadCount()).toBe(1)

    await call(() => addDiscussionComment(form({ owner: OWNER, slug: SLUG, number: '1', body: 'ответ' })))
    expect((await db.select().from(discussionComments)).length, 'и ответить тоже').toBe(1)
  })

  it('посторонний в приватный список по-прежнему не пишет', async () => {
    h.session = { userId: strangerId, handle: 'dg-stranger' }
    expect(await openThread('чужой тред')).toBe(`/${OWNER}/${SLUG}`)
    expect(await threadCount()).toBe(0)
  })

  it('владелец пишет, как и раньше', async () => {
    h.session = { userId: ownerId, handle: OWNER }
    expect(await openThread('свой тред')).toBe(`/${OWNER}/${SLUG}/discussions/1`)
  })
})

describe('частота', () => {
  it('⚠️ порог тредов исчерпывается — и отказ НАЗЫВАЕТ причину адресом', async () => {
    for (let i = 0; i < DISCUSSION_LIMITS.threadPerUser; i++) {
      expect(await openThread(`тред ${i + 1}`), `тред ${i + 1} из порога должен пройти`).toContain('/discussions/')
    }
    const over = await openThread('сверх порога')
    expect(over, 'без ?e=rate страница выглядит так же, как до нажатия').toBe(`/${OWNER}/${SLUG}/discussions?e=rate`)
    expect(await threadCount(), 'сверх порога не записано ничего').toBe(DISCUSSION_LIMITS.threadPerUser)
  })

  it('ответы считаются ОТДЕЛЬНЫМ потоком: исчерпанные треды не затыкают разговор', async () => {
    await openThread('разговор')
    for (let i = 0; i < DISCUSSION_LIMITS.threadPerUser; i++) {
      await openThread(`ещё ${i + 1}`) // добиваем порог тредов
    }
    const url = await call(() => addDiscussionComment(form({ owner: OWNER, slug: SLUG, number: '1', body: 'ответ' })))
    expect(url, 'реплика идёт своим счётчиком').toBe(`/${OWNER}/${SLUG}/discussions/1`)
  })
})
