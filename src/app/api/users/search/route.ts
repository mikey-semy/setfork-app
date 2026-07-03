import { ilike } from 'drizzle-orm'
import { getSession } from '@/shared/auth/session'
import { db, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

// Поиск пользователей по префиксу handle — для @mention в редакторе. Только залогиненным.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json([])
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (!q) return Response.json([])
  const rows = await db
    .select({ handle: users.handle, avatarUrl: users.avatarUrl })
    .from(users)
    .where(ilike(users.handle, `${q}%`))
    .limit(8)
  const out = await Promise.all(rows.map(async (r) => ({ handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 32) })))
  return Response.json(out)
}
