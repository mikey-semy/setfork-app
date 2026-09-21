import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ⚠️ ПРИВАТНОЕ НАЗВАНИЕ НЕ УЕЗЖАЕТ ПИСЬМОМ ТОМУ, КОМУ КОЛОКОЛЬЧИК ЕГО ПРЯЧЕТ.
 *
 * Лента уведомлений спрашивает про доступ на чтении (`keepVisible`) — это чинили как
 * P1. Почта и пуш собирают текст в момент ОТПРАВКИ, читая `templates.title` по id, и
 * того же вопроса не задавали: наблюдатель, оставшийся после закрытия списка, получал
 * новое приватное название В ТЕМЕ ПИСЬМА. Письмо не отзовёшь.
 *
 * Тест держит именно ДОСТАВКУ, а не запись строки: строка остаётся, её видимость лента
 * пересчитывает на чтении, и человек, получивший доступ позже, увидит пропущенное.
 */
const h = vi.hoisted(() => ({ jobs: [] as { kind: string; payload: Record<string, unknown> }[] }))
vi.mock('@/shared/jobs/queue', () => ({
  enqueueJob: async (kind: string, payload: Record<string, unknown>) => void h.jobs.push({ kind, payload }),
}))
vi.mock('@/shared/settings/email', () => ({ emailEnabled: async () => true }))
vi.mock('@/shared/push/vapid', () => ({ pushEnabled: async () => true }))
vi.mock('@/shared/push/send', () => ({ userHasPush: async () => true, sendPushToUser: async () => {} }))

const { db, collaborators, notifications, templates, users } = await import('@/shared/db')
const { notify } = await import('@/features/notifications/notify')

const uid: Record<string, string> = {}
let tplId = ''

/** Доставку включают ОБА канала: без этого гейт проверялся бы вхолостую. */
const WANTS_DELIVERY = { email: true, browser: true }

beforeEach(async () => {
  h.jobs = []
  await resetTables([notifications, collaborators, templates, users])
  const rows = await db
    .insert(users)
    .values([
      { handle: 'dv-owner', email: 'owner@example.com', notifyPrefs: WANTS_DELIVERY },
      { handle: 'dv-outsider', email: 'outsider@example.com', notifyPrefs: WANTS_DELIVERY },
      { handle: 'dv-collab', email: 'collab@example.com', notifyPrefs: WANTS_DELIVERY },
    ])
    .returning({ id: users.id, handle: users.handle })
  for (const r of rows) uid[r.handle] = r.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: uid['dv-owner'], slug: 'secret', title: { ru: 'Переезд на свой сервер' }, visibility: 'public', status: 'published' })
    .returning({ id: templates.id })
  tplId = tpl.id
  await db.insert(collaborators).values({ templateId: tplId, userId: uid['dv-collab'] })
})

const notifyOutsider = () =>
  notify({ recipientId: uid['dv-outsider'], actorId: uid['dv-owner'], type: 'issue_new', templateId: tplId })

const kinds = () => h.jobs.map((j) => j.kind).sort()

describe('доставка наружу уважает видимость списка', () => {
  it('пока список публичный — письмо и пуш уходят', async () => {
    await notifyOutsider()
    expect(kinds()).toEqual(['email', 'push'])
  })

  it('⚠️ список закрыли — постороннему не уходит НИЧЕГО', async () => {
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, tplId))
    await notifyOutsider()
    expect(kinds(), 'приватное название уехало бы в теме письма').toEqual([])
  })

  it('⚠️ но СТРОКА уведомления остаётся: доступ могут вернуть', async () => {
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, tplId))
    await notifyOutsider()
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, uid['dv-outsider']))
    expect(rows, 'ленту фильтрует чтение, а не запись — иначе вернувшийся доступ не покажет пропущенного').toHaveLength(1)
  })

  it('соредактор приватного списка получает доставку: он его видит', async () => {
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, tplId))
    await notify({ recipientId: uid['dv-collab'], actorId: uid['dv-owner'], type: 'issue_new', templateId: tplId })
    expect(kinds()).toEqual(['email', 'push'])
  })

  it('снятый модерацией список молчит так же, как приватный', async () => {
    await db.update(templates).set({ moderation: 'hidden' }).where(eq(templates.id, tplId))
    await notifyOutsider()
    expect(kinds()).toEqual([])
  })

  it('⚠️ ПРИГЛАШЕНИЕ ПРИНЯТЬ СПИСОК доходит, хотя приглашённый его ещё не видит', async () => {
    // Иначе гейт убивает ровно то уведомление, без которого передача зависает молча:
    // приглашённый по определению не владелец и не соредактор. Название списка тут —
    // содержание предложения, а не утечка.
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, tplId))
    await notify({ recipientId: uid['dv-outsider'], actorId: uid['dv-owner'], type: 'transfer_incoming', templateId: tplId })
    expect(kinds(), 'предложение владения обязано дойти').toEqual(['email', 'push'])
  })

  it('⚠️ и ПОДТВЕРЖДЕНИЕ приёма доходит прежнему владельцу, который доступ уже потерял', async () => {
    await db.update(templates).set({ visibility: 'private', ownerId: uid['dv-outsider'] }).where(eq(templates.id, tplId))
    await notify({ recipientId: uid['dv-owner'], actorId: uid['dv-outsider'], type: 'transfer_accepted', templateId: tplId })
    expect(kinds()).toEqual(['email', 'push'])
  })

  it('уведомление БЕЗ списка (подписка на человека) доставляется всегда', async () => {
    await notify({ recipientId: uid['dv-outsider'], actorId: uid['dv-owner'], type: 'follow' })
    expect(kinds(), 'тут нечего скрывать: список не при чём').toEqual(['email', 'push'])
  })
})
