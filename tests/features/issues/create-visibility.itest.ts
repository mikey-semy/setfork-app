import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Линза 02, F4: createIssue держал СВОЮ пару проверок (private + moderation) вместо
// единого предиката canViewList и забыл про ЧЕРНОВИК — посторонний открывал задачу в
// чужом неопубликованном списке. Утечки содержимого нет, но владельцу летело
// уведомление, а в трекере ещё не выпущенного списка появлялся чужой текст.

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  getSession: async () => h.session,
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
  headers: async () => new Headers(),
}))

const { db, users, templates, issues, collaborators } = await import('@/shared/db')
const { createIssue } = await import('@/features/issues/actions')

const OWNER = 'iv-owner'
const uid: Record<string, string> = {}
const ids: Record<string, string> = {}

async function makeList(slug: string, over: Record<string, unknown> = {}): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: slug }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  return t.id
}

/** Экшен заканчивается redirect() — ловим, нас интересует только след в БД. */
async function open(slug: string, title: string): Promise<void> {
  const fd = new FormData()
  fd.set('owner', OWNER)
  fd.set('slug', slug)
  fd.set('title', title)
  try {
    await createIssue(fd)
  } catch {
    /* NEXT_REDIRECT — и отказ, и успех уходят редиректом; смотрим таблицу */
  }
}

const issueCount = async (id: string) => (await db.select().from(issues).where(eq(issues.templateId, id))).length

beforeAll(async () => {
  await resetTables([templates, users])
  for (const k of ['owner', 'stranger', 'collab']) {
    const [u] = await db.insert(users).values({ handle: k === 'owner' ? OWNER : `iv-${k}` }).returning({ id: users.id })
    uid[k] = u.id
  }
  ids.draft = await makeList('draft-list', { status: 'draft' })
  ids.priv = await makeList('priv-list', { visibility: 'private' })
  ids.flagged = await makeList('flag-list', { moderation: 'flagged' })
  ids.open = await makeList('open-list')
  await db.insert(collaborators).values({ templateId: ids.priv, userId: uid.collab })
}, 60_000)

describe('задача в чужом закрытом списке', () => {
  it('посторонний не открывает задачу в ЧЕРНОВИКЕ', async () => {
    h.session = { userId: uid.stranger, handle: 'iv-stranger' }
    await open('draft-list', 'задача в чужом черновике')
    expect(await issueCount(ids.draft)).toBe(0)
  })

  it('приватный и снятый модерацией — тоже отказ', async () => {
    h.session = { userId: uid.stranger, handle: 'iv-stranger' }
    await open('priv-list', 'взлом')
    await open('flag-list', 'взлом')
    expect(await issueCount(ids.priv)).toBe(0)
    expect(await issueCount(ids.flagged)).toBe(0)
  })

  it('владелец в своём черновике задачу заводит', async () => {
    h.session = { userId: uid.owner, handle: OWNER }
    await open('draft-list', 'своя задача')
    expect(await issueCount(ids.draft)).toBe(1)
  })

  it('коллаборатор приватного списка — тоже (перекос выправлен)', async () => {
    h.session = { userId: uid.collab, handle: 'iv-collab' }
    await open('priv-list', 'задача соредактора')
    const rows = await db.select().from(issues).where(eq(issues.templateId, ids.priv))
    expect(rows).toHaveLength(1)
    expect(rows[0].authorId).toBe(uid.collab)
  })

  it('публичный список открыт любому залогиненному (контроль)', async () => {
    h.session = { userId: uid.stranger, handle: 'iv-stranger' }
    await open('open-list', 'обычная задача')
    expect(await issueCount(ids.open)).toBe(1)
  })
})
