import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Добавление соавтора ОПОВЕЩАЕТ обе стороны (фидбек владельца): соавтор узнаёт, что
 * теперь может править список, а владелец получает копию — «чтобы помнить», кому
 * выдал доступ. Заодно держим причину отказа: раньше «нет такого ника» молчал так же,
 * как успех.
 *
 * Подменено только внешнее: очередь писем (её разбирает воркер), сессия (кто нажал),
 * кэш страниц Next, и две настройки инстанса — включены ли почта и пуш.
 */
const h = vi.hoisted(() => ({ jobs: [] as { kind: string; payload: Record<string, unknown> }[], userId: '' }))
vi.mock('@/shared/jobs/queue', () => ({
  enqueueJob: async (kind: string, payload: Record<string, unknown>) => void h.jobs.push({ kind, payload }),
}))
vi.mock('@/shared/settings/email', () => ({ emailEnabled: async () => true }))
vi.mock('@/shared/push/vapid', () => ({ pushEnabled: async () => false }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: h.userId }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { db, collaborators, notifications, templates, users } = await import('@/shared/db')
const { addCollaborator, removeCollaborator } = await import('@/features/collab/actions')

const uid: Record<string, string> = {}
let tplId = ''

beforeEach(async () => {
  h.jobs = []
  await resetTables([notifications, collaborators, templates, users])
  const rows = await db
    .insert(users)
    .values([
      { handle: 'ac-owner', email: 'owner@example.com', notifyPrefs: { email: true } },
      { handle: 'ac-mate', email: 'mate@example.com', notifyPrefs: { email: true } },
      // Ник с заглавными: колонка регистрозависима, такие строки в базе бывали (handleBlock).
      { handle: 'AC-Legacy', email: 'legacy@example.com', notifyPrefs: { email: true } },
      { handle: 'ac-gone', email: 'gone@example.com', notifyPrefs: { email: true }, deleted: true },
    ])
    .returning({ id: users.id, handle: users.handle })
  for (const r of rows) uid[r.handle] = r.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: uid['ac-owner'], slug: 'kit', title: { ru: 'Набор' }, visibility: 'private', status: 'published' })
    .returning({ id: templates.id })
  tplId = tpl.id
  h.userId = uid['ac-owner']
})

const add = (handle: string) => {
  const fd = new FormData()
  fd.set('handle', handle)
  return addCollaborator(tplId, null, fd)
}
const mails = () => h.jobs.filter((j) => j.kind === 'email').map((j) => j.payload.to).sort()

describe('добавление соавтора', () => {
  it('письмо уходит и соавтору, и владельцу; в колокольчике — у обоих', async () => {
    expect(await add('@AC-Mate')).toEqual({ ok: true })
    expect(mails()).toEqual(['mate@example.com', 'owner@example.com'])
    const rows = await db.select({ to: notifications.recipientId, type: notifications.type }).from(notifications)
    expect(rows.map((r) => `${r.to === uid['ac-mate'] ? 'mate' : 'owner'}:${r.type}`).sort()).toEqual([
      'mate:collaborator_added',
      'owner:collaborator_joined',
    ])
  })

  it('повторное «Добавить» того же человека — «уже соавтор», второго письма нет', async () => {
    await add('ac-mate')
    h.jobs = []
    expect(await add('ac-mate')).toEqual({ error: 'already' })
    expect(mails()).toEqual([])
  })

  it('⚠️ «Добавить → Убрать → Добавить» по кругу не шлёт письма заново', async () => {
    // Иначе владелец любого списка слал бы человеку неотключаемые письма со своим
    // названием списка сколько угодно раз (ревью по линзе безопасности).
    await add('ac-mate')
    for (let i = 0; i < 3; i++) {
      await removeCollaborator(tplId, uid['ac-mate'])
      h.jobs = []
      expect(await add('ac-mate')).toEqual({ ok: true })
      expect(mails(), `виток ${i + 1}`).toEqual([])
    }
  })

  it('ник сверяется без учёта регистра', async () => {
    expect(await add('ac-legacy')).toEqual({ ok: true })
  })

  it('удалённый аккаунт не находится', async () => {
    expect(await add('ac-gone')).toEqual({ error: 'notFound' })
  })

  it('чужой список — отказ ДО поиска ника: по ответу не узнать, есть ли такой человек', async () => {
    h.userId = uid['ac-mate']
    expect(await add('ac-owner')).toEqual({ error: 'forbidden' })
    expect(await add('nobody-here')).toEqual({ error: 'forbidden' })
  })

  it('нет такого ника — называется называется причина, писем нет', async () => {
    expect(await add('@nobody-here')).toEqual({ error: 'notFound' })
    expect(mails()).toEqual([])
  })

  it('свой ник — отдельная причина, а не молчание', async () => {
    expect(await add('ac-owner')).toEqual({ error: 'owner' })
  })
})
