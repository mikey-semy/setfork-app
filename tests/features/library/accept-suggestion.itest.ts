import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// acceptSuggestion против реального Postgres: только владелец списка принимает; принятие
// создаёт новую версию через фасад listStore.addVersion. Мокаем границу Next + уведомления
// /реиндекс (не суть теста); БД, проверка владения и запись версии — настоящие.
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
    throw Object.assign(new Error('REDIRECT'), { url })
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('@/features/notifications/notify', () => ({ notify: async () => {}, notifyMany: async () => {}, notifyMentions: async () => {} }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: async () => {} }))

const { db, templates, users, suggestions, templateVersions } = await import('@/shared/db')
const { acceptSuggestion } = await import('@/features/library/actions')

let ownerId = ''
let otherId = ''
let authorId = ''

async function seedTemplate(): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: `s-${Math.random().toString(36).slice(2)}`, title: { en: 'S' }, status: 'published', visibility: 'public', currentVersion: 1 })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'init' })
  return t.id
}
async function seedSuggestion(templateId: string, status: 'open' | 'accepted' = 'open'): Promise<string> {
  const item = { type: 'step', content: {}, title: { en: 'new step' }, desc: {}, command: '', level: 'required', why: {}, section: {}, subtasks: [], refs: [], imageKey: null }
  const [s] = await db
    .insert(suggestions)
    .values({ templateId, authorId, baseVersion: 1, status, note: 'please add', items: [item] as never })
    .returning({ id: suggestions.id })
  return s.id
}
const sugStatus = async (id: string) => (await db.query.suggestions.findFirst({ where: (s, { eq }) => eq(s.id, id) }))?.status
const versionCount = async (tplId: string) => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(templateVersions).where(sql`${templateVersions.templateId} = ${tplId}`)
  return r?.n ?? 0
}

beforeEach(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'aowner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'aother' }).returning({ id: users.id })
  const [a] = await db.insert(users).values({ handle: 'aauthor' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
  authorId = a.id
})
afterAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
})

describe('acceptSuggestion — владение + создание версии', () => {
  it('не-владелец не может принять предложение (остаётся open, версия не создаётся)', async () => {
    const tpl = await seedTemplate()
    const sug = await seedSuggestion(tpl)
    h.session = { userId: otherId, handle: 'aother' }
    await acceptSuggestion(sug).catch(() => {})
    expect(await sugStatus(sug)).toBe('open')
    expect(await versionCount(tpl)).toBe(1) // новой версии нет
  })

  it('владелец принимает → предложение accepted + создана новая версия', async () => {
    const tpl = await seedTemplate()
    const sug = await seedSuggestion(tpl)
    h.session = { userId: ownerId, handle: 'aowner' }
    await acceptSuggestion(sug).catch(() => {}) // успех завершается redirect'ом
    expect(await sugStatus(sug)).toBe('accepted')
    expect(await versionCount(tpl)).toBe(2) // добавлена версия через фасад addVersion
  })

  it('уже принятое предложение → no-op', async () => {
    const tpl = await seedTemplate()
    const sug = await seedSuggestion(tpl, 'accepted')
    h.session = { userId: ownerId, handle: 'aowner' }
    await acceptSuggestion(sug).catch(() => {})
    expect(await versionCount(tpl)).toBe(1) // status !== open → ранний return
  })
})
