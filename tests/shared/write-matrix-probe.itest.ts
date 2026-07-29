import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Линза 02, пункт 3 «обход владения на запись»: посторонний пишет в ДЕТЕЙ чужого
// приватного/черновикового списка. Дёргаем настоящие server actions с чужой сессией.

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

const { db, users, templates, templateVersions, steps, watches, issues, notifications } = await import('@/shared/db')
const { ensureWatch, toggleWatch } = await import('@/features/watch/actions')
const { getWatcherIds } = await import('@/features/watch/queries')
const { notifyMany } = await import('@/features/notifications/notify')
const { getNotifications } = await import('@/features/notifications/queries')
const { createIssue } = await import('@/features/issues/actions')
const { toggleReaction } = await import('@/features/reactions/actions')

const OWNER = 'wmowner'
const uid: Record<string, string> = {}
const ids: Record<string, string> = {}

async function makeList(slug: string, over: Record<string, unknown>, marker: string): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: `T-${marker}`, ru: `Т-${marker}` }, desc: {}, tags: [], currentVersion: 1, ...over })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'seed', authorId: uid.owner })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: `S-${marker}` }, desc: {} })
  return t.id
}

/** Экшен с redirect()/throw внутри — ловим, нас интересует только след в БД. */
async function attempt(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    /* redirect/NEXT_REDIRECT/no session — это отказ, проверяем по таблицам */
  }
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  for (const [k, handle] of [
    ['owner', OWNER],
    ['stranger', 'wmstranger'],
  ] as const) {
    const [u] = await db.insert(users).values({ handle, name: handle }).returning({ id: users.id })
    uid[k] = u.id
  }
  ids.priv = await makeList('priv-list', { visibility: 'private' }, 'PRIVCANARY')
  ids.draft = await makeList('draft-list', { status: 'draft' }, 'DRAFTCANARY')
  ids.flagged = await makeList('flagged-list', { moderation: 'flagged' }, 'FLAGCANARY')
}, 60_000)

describe('подписка на чужой приватный список', () => {
  it('toggleWatch (кнопка Watch) приватный чужому НЕ подписывает', async () => {
    h.session = { userId: uid.stranger, handle: 'wmstranger' }
    await attempt(() => toggleWatch(ids.priv))
    const rows = await db.select().from(watches).where(and(eq(watches.templateId, ids.priv), eq(watches.userId, uid.stranger)))
    expect(rows).toHaveLength(0)
  })

  it('а ensureWatch — подписывает: тот же экспорт из "use server", но без проверки видимости', async () => {
    h.session = { userId: uid.stranger, handle: 'wmstranger' }
    await attempt(() => ensureWatch(ids.priv))
    const rows = await db.select().from(watches).where(and(eq(watches.templateId, ids.priv), eq(watches.userId, uid.stranger)))
    expect(rows.length).toBeGreaterThan(0)
  })

  it('и подписка доносит до постороннего заголовок и слаг приватного списка', async () => {
    // Ровно то, что делает push/новая версия: уведомить наблюдателей.
    const watchers = await getWatcherIds(ids.priv, 'versions')
    expect(watchers).toContain(uid.stranger)
    await notifyMany(watchers, { type: 'new_version', templateId: ids.priv })
    const feed = await getNotifications(uid.stranger)
    const leaked = JSON.stringify(feed)
    expect(leaked).toContain('PRIVCANARY')
    expect(leaked).toContain('priv-list')
  })
})

describe('запись в детей нечитаемого списка', () => {
  it('createIssue: приватный и снятый модерацией — отказ', async () => {
    h.session = { userId: uid.stranger, handle: 'wmstranger' }
    for (const [slug, id] of [
      ['priv-list', ids.priv],
      ['flagged-list', ids.flagged],
    ] as const) {
      const fd = new FormData()
      fd.set('owner', OWNER)
      fd.set('slug', slug)
      fd.set('title', 'взлом')
      await attempt(() => createIssue(fd))
      expect(await db.select().from(issues).where(eq(issues.templateId, id))).toHaveLength(0)
    }
  })

  it('createIssue: ЧЕРНОВИК — посторонний задачу открывает (своя копия предиката без status)', async () => {
    h.session = { userId: uid.stranger, handle: 'wmstranger' }
    const fd = new FormData()
    fd.set('owner', OWNER)
    fd.set('slug', 'draft-list')
    fd.set('title', 'задача в чужом черновике')
    await attempt(() => createIssue(fd))
    const rows = await db.select().from(issues).where(eq(issues.templateId, ids.draft))
    expect(rows).toHaveLength(1)
    expect(rows[0].authorId).toBe(uid.stranger)
  })

  it('toggleReaction на шаг приватного списка — отказ', async () => {
    h.session = { userId: uid.stranger, handle: 'wmstranger' }
    const [v] = await db.select().from(templateVersions).where(eq(templateVersions.templateId, ids.priv)).limit(1)
    const [st] = await db.select().from(steps).where(eq(steps.versionId, v.id)).limit(1)
    await attempt(() => toggleReaction({ targetType: 'step', targetId: st.id, emoji: '👍', path: '/' }))
    const { reactions } = await import('@/shared/db')
    expect(await db.select().from(reactions).where(eq(reactions.targetId, st.id))).toHaveLength(0)
  })
})

describe('список закрыли постфактум — что с уже подписанными', () => {
  it('подписчик публичного списка после перевода в private продолжает получать заголовок и активность', async () => {
    await db.delete(notifications)
    const pub = await makeList('was-public', {}, 'FLIPCANARY')
    // Посторонний подписался, пока список был публичным — законно.
    h.session = { userId: uid.stranger, handle: 'wmstranger' }
    await attempt(() => toggleWatch(pub))
    expect(await getWatcherIds(pub, 'versions')).toContain(uid.stranger)

    // Владелец закрывает список.
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, pub))

    // Дальнейшая активность (новая версия) уходит прежним наблюдателям.
    const watchers = await getWatcherIds(pub, 'versions')
    await notifyMany(watchers, { type: 'new_version', templateId: pub })
    const feed = JSON.stringify(await getNotifications(uid.stranger))
    expect(watchers).toContain(uid.stranger)
    expect(feed).toContain('FLIPCANARY')
    expect(feed).toContain('was-public')
  })
})

describe('уведомления не подмешивают чужое', () => {
  it('посторонний без подписки не видит уведомлений о приватном списке', async () => {
    await db.delete(notifications)
    const feed = await getNotifications(uid.stranger)
    expect(feed).toHaveLength(0)
  })
})
