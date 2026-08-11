import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Ж1b доставка против реального PG: по verdict='broken' садовник открывает ОДИН
// issue на список (метка broken-link, URL + archive в теле, владелец уведомлён);
// дедуп не плодит второй; unreachable НЕ доставляется; выключено по умолчанию.
const { appSettings, db, issues, linkChecks, linkOccurrences, notifications, templates, users } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')
const { harvestTemplate } = await import('@/features/linkcheck/harvest')
const { deliverBrokenLinks } = await import('@/features/linkcheck/deliver')
const { clearLinkcheckCache } = await import('@/shared/settings/linkcheck')

let templateId = ''
let ownerId = ''
const DEAD = 'https://ref.example.com/guide'

const wipe = () =>
  resetTables([templates, users, linkChecks, linkOccurrences, appSettings, issues, notifications])

const setDeadVerdict = async (verdict: 'broken' | 'unreachable') =>
  db.update(linkChecks).set({ verdict }).where(eq(linkChecks.urlNorm, DEAD))

const setDeliver = async (on: boolean) => {
  await db.delete(appSettings).where(eq(appSettings.key, 'linkcheck.deliver_issues'))
  await db.insert(appSettings).values({ key: 'linkcheck.deliver_issues', value: on ? 'true' : 'false' })
  clearLinkcheckCache()
}

beforeAll(async () => {
  await wipe()
  const [owner] = await db.insert(users).values({ handle: 'delowner' }).returning({ id: users.id })
  ownerId = owner.id
  const list = await listStore.create({
    ownerId,
    slug: 'del-demo',
    title: { en: 'Deliver demo' },
    desc: {},
    tags: [],
    ordered: true,
    visibility: 'public',
    status: 'published',
    origin: 'authored',
    note: 'seed',
    steps: [
      {
        n: 1,
        type: 'step',
        content: {},
        title: { en: 'Step' },
        desc: {},
        command: '',
        level: 'required',
        why: {},
        section: {},
        subtasks: [],
        refs: [{ label: { en: 'Guide' }, url: DEAD }],
        imageRef: null,
      },
    ],
  })
  templateId = list.id
  // Доставка берёт только active-списки — гарантируем статус модерации.
  await db.update(templates).set({ moderation: 'active' }).where(eq(templates.id, templateId))
  await harvestTemplate(templateId) // populate link_occurrences + link_checks (verdict=null)
})
afterAll(wipe)

describe('deliverBrokenLinks', () => {
  it('выключено по умолчанию — issue не открывается даже при broken', async () => {
    await setDeadVerdict('broken')
    await setDeliver(false)
    const r = await deliverBrokenLinks()
    expect(r.opened).toBe(0)
    expect(await db.select().from(issues)).toHaveLength(0)
  })

  it('broken → один issue садовника: метка broken-link, URL + archive в теле, автор gardener, владелец уведомлён', async () => {
    await setDeadVerdict('broken')
    await setDeliver(true)
    const r = await deliverBrokenLinks()
    expect(r.opened).toBe(1)

    const rows = await db.select().from(issues).where(eq(issues.templateId, templateId))
    expect(rows).toHaveLength(1)
    const iss = rows[0]
    expect(iss.labels).toContain('broken-link')
    expect(iss.body).toContain(DEAD)
    expect(iss.body).toContain('web.archive.org')
    expect(iss.title).toContain('1') // счётчик битых ссылок

    const [author] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, iss.authorId))
    expect(author.handle).toBe('gardener')

    const notes = await db.select().from(notifications).where(eq(notifications.recipientId, ownerId))
    expect(notes.some((n) => n.type === 'issue_new')).toBe(true)
  })

  it('дедуп: повторная доставка не плодит второй issue', async () => {
    const r = await deliverBrokenLinks()
    expect(r.opened).toBe(0)
    expect(await db.select().from(issues).where(eq(issues.templateId, templateId))).toHaveLength(1)
  })

  it('unreachable НЕ доставляется (ТСПУ/бот-блок ≠ мёртвая ссылка)', async () => {
    await db.delete(issues).where(eq(issues.templateId, templateId))
    await setDeadVerdict('unreachable')
    const r = await deliverBrokenLinks()
    expect(r.opened).toBe(0)
    expect(await db.select().from(issues)).toHaveLength(0)
  })
})
