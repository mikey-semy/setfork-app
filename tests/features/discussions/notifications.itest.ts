import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ⚠️ ОБСУЖДЕНИЕ НАКОНЕЦ ЗВУЧИТ: О НЁМ УЗНАЮТ ЛЮДИ.
 *
 * Раздел не рассылал НИЧЕГО — ни владельцу списка, ни автору треда, ни собеседникам, ни
 * упомянутым. Тред появлялся и лежал, пока кто-нибудь случайно не заглянет. Для раздела,
 * весь смысл которого — разговор, это отменяет сам разговор: спросить было можно,
 * услышать ответ — нет.
 *
 * Проверяем на настоящей базе то, что видно снаружи: кому пришло, кому НЕ пришло и куда
 * ведёт ссылка. Уведомление, ведущее «в список» вместо треда, немногим лучше молчания —
 * человек всё равно ищет разговор глазами.
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
// Почта и пуш — внешние каналы; проверяем запись уведомления, а не доставку.
vi.mock('@/shared/jobs/queue', () => ({ enqueueJob: async () => {} }))

const { db, discussionComments, discussions, notifications, templates, users, watches } = await import('@/shared/db')
const { createDiscussion, addDiscussionComment } = await import('@/features/discussions/actions')
const { resolveNotificationDisplay } = await import('@/features/notifications/display')

const OWNER = 'dn-owner'
const SLUG = 'talk-list'
const uid: Record<string, string> = {}
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

const openThread = (title: string, body = 'текст') =>
  call(() => createDiscussion(null, form({ owner: OWNER, slug: SLUG, title, body })))
const reply = (body: string) => call(() => addDiscussionComment(form({ owner: OWNER, slug: SLUG, number: '1', body })))

/** Что лежит в ящике у человека. */
const inbox = async (who: string) =>
  db
    .select({ type: notifications.type, discussionId: notifications.discussionId, templateId: notifications.templateId })
    .from(notifications)
    .where(eq(notifications.recipientId, uid[who]))

beforeEach(async () => {
  await resetTables([notifications, watches, discussionComments, discussions, templates, users])
  const handles = [OWNER, 'dn-author', 'dn-replier', 'dn-watcher', 'dn-quiet', 'dn-mentioned', 'dn-optout']
  const rows = await db
    .insert(users)
    .values(handles.map((handle) => ({ handle })))
    .returning({ id: users.id, handle: users.handle })
  for (const handle of handles) {
    const row = rows.find((r) => r.handle === handle)
    if (!row) throw new Error(`не завёлся пользователь ${handle}`)
    uid[handle] = row.id
  }
  // Ручку «новые обсуждения» этот человек выключил.
  await db.update(users).set({ notifyPrefs: { discussions: false } }).where(eq(users.id, uid['dn-optout']))

  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: uid[OWNER], slug: SLUG, title: { en: 'Talk list' }, status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  tplId = tpl.id

  // Наблюдатели: один выбрал событие «обсуждения», второй — только версии.
  await db.insert(watches).values([
    { templateId: tplId, userId: uid['dn-watcher'], level: 'custom', events: { discussions: true } },
    { templateId: tplId, userId: uid['dn-quiet'], level: 'custom', events: { versions: true } },
  ])

  h.session = { userId: uid['dn-author'], handle: 'dn-author' }
})

describe('новое обсуждение', () => {
  it('⚠️ владелец списка УЗНАЁТ о нём — и ссылка ведёт в тред, а не в список', async () => {
    await openThread('как быть с шагом 3')

    const box = await inbox(OWNER)
    expect(box.map((n) => n.type), 'раньше не приходило ничего').toEqual(['discussion_new'])
    expect(box[0].discussionId, 'без ссылки на тред уведомление ведёт в список').toBeTruthy()

    const shown = await resolveNotificationDisplay({
      lang: 'ru',
      actorId: uid['dn-author'],
      type: 'discussion_new',
      templateId: tplId,
      discussionId: box[0].discussionId,
    })
    expect(shown.url).toContain(`/${OWNER}/${SLUG}/discussions/1`)
    expect(shown.verb, 'глагол должен быть свой, а не пустой').toBeTruthy()
  })

  it('наблюдатель, выбравший «обсуждения», получает; выбравший только версии — нет', async () => {
    await openThread('первый тред')
    expect((await inbox('dn-watcher')).map((n) => n.type)).toEqual(['discussion_new'])
    expect(await inbox('dn-quiet'), 'событие он не выбирал').toEqual([])
  })

  it('выключенная ручка «новые обсуждения» молчит', async () => {
    // Список принадлежит человеку, который выключил ручку: он владелец и в круге.
    await db.update(templates).set({ ownerId: uid['dn-optout'] }).where(eq(templates.id, tplId))
    await openThread('тред в чужом списке')
    expect(await inbox('dn-optout')).toEqual([])
  })

  it('автору собственного треда себе не шлём', async () => {
    await openThread('свой тред')
    expect(await inbox('dn-author')).toEqual([])
  })
})

describe('ответ в обсуждении', () => {
  it('⚠️ автор треда и прежние собеседники узнают об ответе — даже не будучи наблюдателями', async () => {
    await openThread('вопрос')

    // ⚠️ СНИМАЕМ ПОДПИСКИ УЧАСТНИКОВ. Заведя тред, человек автоматически становится
    // наблюдателем списка, и без этого шага он получал бы ответ КАК НАБЛЮДАТЕЛЬ — то
    // есть тест зеленел бы, даже если участников треда забыли в рассылке (проверено
    // мутацией: без снятия подписок она проходила незамеченной). Уровень
    // «участвую» — это и есть отсутствие строки: он значит «шлите про то, где я
    // участвую», и держится он именно явным списком получателей.
    await db.delete(watches).where(eq(watches.userId, uid['dn-author']))

    h.session = { userId: uid['dn-replier'], handle: 'dn-replier' }
    await reply('первый ответ')
    expect((await inbox('dn-author')).map((n) => n.type), 'автор треда обязан услышать ответ').toContain('discussion_comment')

    // Прежний собеседник тоже: он в разговоре, хоть и не наблюдатель.
    await db.delete(watches).where(eq(watches.userId, uid['dn-replier']))
    h.session = { userId: uid[OWNER], handle: OWNER }
    await reply('второй ответ')
    expect((await inbox('dn-replier')).map((n) => n.type)).toContain('discussion_comment')
  })
})

describe('упоминание в обсуждении', () => {
  it('⚠️ упомянутый получает уведомление, и оно ведёт в ТРЕД', async () => {
    await openThread('позовём человека', 'посмотри, пожалуйста, @dn-mentioned')

    const box = await inbox('dn-mentioned')
    expect(box.map((n) => n.type)).toEqual(['mention'])
    expect(box[0].discussionId, 'иначе упоминание приводит в список, а не в разговор').toBeTruthy()
  })
})
