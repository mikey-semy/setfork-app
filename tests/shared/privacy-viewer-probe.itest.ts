import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appSettings, db, jobs, templates, users } from '@/shared/db'

// ЛИНЗА 04 · кому видно чужое: поверхности, которые линза 02 не разбирала —
// профиль (приватный), исходящая почта и web-push. Вызываются НАСТОЯЩИЕ
// обработчики; наружу смотрим по телу ответа/письма, а не по коду.

const SECRET_TITLE = 'ЗАКРЫТЫЙ-СПИСОК-Q4X8'

const sentMail = vi.hoisted(() => ({ last: null as { to: string; subject: string; html: string } | null }))
vi.mock('@/shared/email/mailer', () => ({
  sendMail: async (m: { to: string; subject: string; html: string }) => {
    sentMail.last = m
    return true
  },
}))

const sessionRef = vi.hoisted(() => ({ current: null as { userId: string; handle: string } | null }))
vi.mock('@/shared/auth/session', () => ({
  getSession: async () => sessionRef.current,
  requireSession: async () => sessionRef.current,
}))

let ownerId = ''
let strangerId = ''
let listId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${users}, ${templates}, ${appSettings}, ${jobs} restart identity cascade`)
  await db.insert(appSettings).values([{ key: 'smtp.host', value: 'localhost' }])

  const [owner] = await db.insert(users).values({ handle: 'vm-owner' }).returning({ id: users.id })
  ownerId = owner.id
  // Посторонний с ПРИВАТНЫМ профилем и включённой почтой.
  const [stranger] = await db
    .insert(users)
    .values({
      handle: 'vm-hidden',
      email: 'hidden@example.com',
      profilePrivate: true,
      notifyPrefs: { email: true },
    })
    .returning({ id: users.id })
  strangerId = stranger.id

  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'closed', title: { ru: SECRET_TITLE, en: SECRET_TITLE }, visibility: 'private', status: 'published' })
    .returning({ id: templates.id })
  listId = tpl.id
})

afterAll(async () => {
  vi.restoreAllMocks()
  await db.execute(sql`truncate table ${users}, ${templates}, ${appSettings}, ${jobs} restart identity cascade`)
})

describe('линза 04 · профиль: обещание «вы не появляетесь в поиске людей»', () => {
  it('поиск людей (features/profile/search) приватного НЕ отдаёт', async () => {
    const { searchPeople } = await import('@/features/profile/search')
    const rows = await searchPeople({ q: 'vm-' })
    expect(rows.map((r) => r.handle)).not.toContain('vm-hidden')
  })

  it('НО /api/users/search отдаёт его АНОНИМУ (ник + аватар)', async () => {
    sessionRef.current = null
    const { GET } = await import('@/app/api/users/search/route')
    const res = await GET(new Request('http://localhost/api/users/search?q=vm-'))
    const body = (await res.json()) as { handle: string }[]
    expect(body.map((r) => r.handle)).toContain('vm-hidden')
  })
})

describe('линза 04 · профиль: счётчики выдают число СКРЫТЫХ списков', () => {
  it('getProfileCounts считает приватные и черновики — постороннему видно «сколько всего»', async () => {
    // У vm-owner уже есть 1 приватный список; добавим публичный и черновик.
    await db.insert(templates).values([
      { ownerId, slug: 'open-one', title: { ru: 'Открытый' }, visibility: 'public', status: 'published' },
      { ownerId, slug: 'draft-one', title: { ru: 'Черновик' }, visibility: 'public', status: 'draft' },
    ])
    const { getProfileCounts } = await import('@/features/profile/queries')
    const { getUserTemplates } = await import('@/features/library/queries')

    const counts = await getProfileCounts(ownerId) // ровно так зовёт страница профиля
    const visibleToStranger = await getUserTemplates(ownerId, undefined)

    expect(counts.lists).toBe(3) // приватный + публичный + черновик
    expect(visibleToStranger.length).toBe(1) // а показать можно только один
  })

  it('контроль: граф активности приватное НЕ светит (там гейт зрителя есть)', async () => {
    const { getContributions } = await import('@/features/profile/queries')
    const anon = await getContributions(ownerId, undefined, undefined)
    const owner = await getContributions(ownerId, undefined, ownerId)
    expect(anon.length).toBeLessThanOrEqual(owner.length)
  })
})

describe('линза 04 · почта и push: заголовок приватного списка уезжает постороннему', () => {
  it('notify → очередь письма → письмо с заголовком приватного списка', async () => {
    const { notify } = await import('@/features/notifications/notify')
    await notify({ recipientId: strangerId, actorId: ownerId, type: 'new_version', templateId: listId })

    const [job] = await db.select({ type: jobs.type, payload: jobs.payload }).from(jobs).where(eq(jobs.type, 'email'))
    expect(job).toBeTruthy()

    const { runEmailJob } = await import('@/features/notifications/jobs')
    await runEmailJob(job.payload)

    expect(sentMail.last?.to).toBe('hidden@example.com')
    // Заголовок закрытого списка — в теме и в теле письма, у человека, который
    // на самом сайте этот список открыть не может.
    expect(sentMail.last?.subject).toContain(SECRET_TITLE)
    expect(sentMail.last?.html).toContain(SECRET_TITLE)
  })

  it('тот же резолвер кормит web-push — гейта видимости нет и там', async () => {
    const { resolveNotificationDisplay } = await import('@/features/notifications/display')
    const d = await resolveNotificationDisplay({ lang: 'ru', actorId: ownerId, type: 'new_version', templateId: listId })
    expect(d.listTitle).toBe(SECRET_TITLE)
    expect(d.url).toContain('/vm-owner/closed')
  })
})
