import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Линза 02, F8: подписка переживала закрытие списка. Две половины одной дыры —
// ensureWatch (экспорт из 'use server') подписывал кого угодно на что угодно, а
// watcherIds не смотрел видимость вовсе, поэтому в ленту постороннего продолжали
// капать заголовок, слаг и факт активности УЖЕ закрытого списка.

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  getSession: async () => h.session,
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))

const { db, users, templates, templateVersions, steps, watches, notifications, collaborators } = await import('@/shared/db')
const { ensureWatch, toggleWatch } = await import('@/features/watch/actions')
const { getWatcherIds } = await import('@/features/watch/queries')
const { notifyMany } = await import('@/features/notifications/notify')
const { getNotifications, getUnreadCount } = await import('@/features/notifications/queries')

const uid: Record<string, string> = {}
const ids: Record<string, string> = {}

async function makeList(slug: string, over: Record<string, unknown>, marker: string): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: `T-${marker}` }, desc: {}, tags: [], currentVersion: 1, ...over })
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

const watchRows = (listId: string, userId: string) =>
  db.select().from(watches).where(and(eq(watches.templateId, listId), eq(watches.userId, userId)))

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  for (const k of ['owner', 'stranger', 'collab']) {
    const [u] = await db.insert(users).values({ handle: `w-${k}`, name: k }).returning({ id: users.id })
    uid[k] = u.id
  }
  ids.priv = await makeList('priv-list', { visibility: 'private' }, 'PRIVCANARY')
  await db.insert(collaborators).values({ templateId: ids.priv, userId: uid.collab })
}, 60_000)

describe('подписка на чужой приватный список', () => {
  it('ensureWatch постороннего на приватный — отказ (как у кнопки Watch)', async () => {
    h.session = { userId: uid.stranger, handle: 'w-stranger' }
    await attempt(() => toggleWatch(ids.priv))
    expect(await watchRows(ids.priv, uid.stranger)).toHaveLength(0)
    await attempt(() => ensureWatch(ids.priv))
    expect(await watchRows(ids.priv, uid.stranger)).toHaveLength(0)
  })

  it('коллаборатор приватного списка подписывается — список ведут вместе', async () => {
    h.session = { userId: uid.collab, handle: 'w-collab' }
    await attempt(() => ensureWatch(ids.priv))
    expect(await watchRows(ids.priv, uid.collab)).toHaveLength(1)
    expect(await getWatcherIds(ids.priv, 'versions')).toContain(uid.collab)
  })
})

describe('список закрыли постфактум', () => {
  it('рассылка прекращается, а подписка сохраняется и оживает при открытии обратно', async () => {
    await db.delete(notifications)
    const pub = await makeList('was-public', {}, 'FLIPCANARY')

    // Посторонний подписался, пока список был публичным — законно.
    h.session = { userId: uid.stranger, handle: 'w-stranger' }
    await attempt(() => toggleWatch(pub))
    expect(await getWatcherIds(pub, 'versions')).toContain(uid.stranger)

    // Владелец закрывает список.
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, pub))

    const watchers = await getWatcherIds(pub, 'versions')
    expect(watchers).not.toContain(uid.stranger)
    await notifyMany(watchers, { type: 'new_version', templateId: pub })
    const feed = JSON.stringify(await getNotifications(uid.stranger))
    expect(feed).not.toContain('FLIPCANARY')
    expect(feed).not.toContain('was-public')

    // Строку подписки не удаляем: список могут открыть обратно.
    expect(await watchRows(pub, uid.stranger)).toHaveLength(1)
    await db.update(templates).set({ visibility: 'public' }).where(eq(templates.id, pub))
    expect(await getWatcherIds(pub, 'versions')).toContain(uid.stranger)
  })

  it('УЖЕ ПРИШЕДШЕЕ уведомление про закрытый список пропадает из ленты', async () => {
    // Дыра не в рассылке, а в чтении: строка уведомления живёт вечно, а лента брала у
    // списка ТЕКУЩИЕ заголовок и слаг без проверки доступа. Значит приватные
    // переименования читались бывшим наблюдателем из своей ленты (P1 из авто-ревью).
    const pub = await makeList('old-notif-list', {}, 'OLDCANARY')
    await notifyMany([uid.stranger, uid.owner], { type: 'new_version', templateId: pub })
    expect(JSON.stringify(await getNotifications(uid.stranger))).toContain('OLDCANARY')
    const before = await getUnreadCount(uid.stranger)

    // Список закрывают и переименовывают уже приватно.
    await db
      .update(templates)
      .set({ visibility: 'private', slug: 'renamed-privately', title: { en: 'PRIVATE-RENAME' } })
      .where(eq(templates.id, pub))

    const feed = JSON.stringify(await getNotifications(uid.stranger))
    expect(feed).not.toContain('PRIVATE-RENAME')
    expect(feed).not.toContain('renamed-privately')
    expect(feed).not.toContain('OLDCANARY')
    // Счётчик считает по тем же правилам: бейдж «1» с пустой лентой — тоже сигнал.
    expect(await getUnreadCount(uid.stranger)).toBe(before - 1)

    // Владельцу его же уведомление видно по-прежнему.
    expect(JSON.stringify(await getNotifications(uid.owner))).toContain('PRIVATE-RENAME')
  })

  it('снятый модерацией: рассылка остаётся только владельцу', async () => {
    const flagged = await makeList('flag-list', {}, 'FLAGCANARY')
    h.session = { userId: uid.stranger, handle: 'w-stranger' }
    await attempt(() => toggleWatch(flagged))
    h.session = { userId: uid.owner, handle: 'w-owner' }
    await attempt(() => toggleWatch(flagged))
    await db.update(templates).set({ moderation: 'flagged' }).where(eq(templates.id, flagged))

    const watchers = await getWatcherIds(flagged, 'versions')
    expect(watchers).not.toContain(uid.stranger)
    expect(watchers).toContain(uid.owner)
  })
})
