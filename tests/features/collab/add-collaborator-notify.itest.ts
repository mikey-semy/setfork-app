import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Добавление соавтора ОПОВЕЩАЕТ обе стороны (фидбек владельца): соавтор узнаёт, что
 * теперь может править список, а владелец получает копию — «чтобы помнить», кому
 * выдал доступ. Заодно держим причину отказа: раньше «нет такого ника» молчал так же,
 * как успех.
 *
 * Подменено только внешнее: очередь писем (её разбирает воркер), сессия (кто нажал),
 * кэш страниц Next.
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
const { addCollaborator } = await import('@/features/collab/actions')

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

  it('повторное «Добавить» того же человека второго письма не шлёт', async () => {
    await add('ac-mate')
    h.jobs = []
    expect(await add('ac-mate')).toEqual({ ok: true })
    expect(mails()).toEqual([])
  })

  it('нет такого ника — называется причина и возвращается набранное, писем нет', async () => {
    expect(await add('@nobody-here')).toEqual({ error: 'notFound', handle: 'nobody-here' })
    expect(mails()).toEqual([])
  })

  it('свой ник — отдельная причина, а не молчание', async () => {
    expect(await add('ac-owner')).toEqual({ error: 'owner', handle: 'ac-owner' })
  })
})
