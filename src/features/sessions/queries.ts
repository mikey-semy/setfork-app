import 'server-only'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db, sessions, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

const ONLINE_WINDOW_MS = 5 * 60_000
const STALE_MS = 7 * 24 * 3600 * 1000
const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000

/** UA → короткая метка «Chrome · Windows». */
export function parseUA(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS'
  const br = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  return `${br} · ${os}`
}

export interface UserSession {
  id: string
  device: string
  ip: string | null
  createdAt: Date
  lastSeenAt: Date
  current: boolean
  online: boolean
  stale: boolean
}

export async function getUserSessions(userId: string, currentSid?: string): Promise<UserSession[]> {
  // Только не протухшие (протухшие вычищаются при следующем входе).
  const fresh = new Date(Date.now() - SESSION_MAX_AGE_MS)
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gte(sessions.lastSeenAt, fresh)))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(50) // потолок показа (сессии дедупятся по устройству + капаются в startSession)
  const now = Date.now()
  return rows.map((r) => ({
    id: r.id,
    device: parseUA(r.userAgent),
    ip: r.ip,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    current: r.id === currentSid,
    online: now - new Date(r.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
    stale: now - new Date(r.lastSeenAt).getTime() > STALE_MS,
  }))
}

export interface OnlineUser {
  userId: string
  handle: string
  avatarUrl: string | null
  lastSeenAt: Date
}

/** Пользователи с активной сессией за последние 5 минут (для админа). */
export async function getOnlineUsers(): Promise<OnlineUser[]> {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS)
  const rows = await db
    .select({
      userId: users.id,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      lastSeenAt: sql<Date>`max(${sessions.lastSeenAt})`,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(gte(sessions.lastSeenAt, since))
    .groupBy(users.id, users.handle, users.avatarUrl)
    .orderBy(desc(sql`max(${sessions.lastSeenAt})`))
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 64) })))
}
