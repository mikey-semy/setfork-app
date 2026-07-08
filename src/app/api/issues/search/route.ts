import { and, desc, eq, ilike, sql } from 'drizzle-orm'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { db, issues } from '@/shared/db'
import { resolveListBySlug } from '@/shared/db/resolve-list'
import { canViewList } from '@/core'
import { rateLimit, tooMany } from '@/shared/rate-limit'

// Поиск issue репо для #-reference в редакторе. Только залогиненным.
// q числовой → по номеру (префикс); иначе → по заголовку; пусто → последние.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json([])
  const rl = await rateLimit(`isearch:${session.userId}`, 60, 60_000)
  if (!rl.ok) return tooMany(rl)

  const url = new URL(req.url)
  const owner = url.searchParams.get('owner') ?? ''
  const slug = url.searchParams.get('slug') ?? ''
  const q = (url.searchParams.get('q') ?? '').trim()

  const tpl = await resolveListBySlug(owner, slug)
  // Не отдаём issue приватного/скрытого списка тому, кто его не видит.
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId, isAdmin: isAdminHandle(session.handle) })) {
    return Response.json([])
  }

  const conds = [eq(issues.templateId, tpl.id)]
  if (q) conds.push(/^\d+$/.test(q) ? sql`${issues.number}::text like ${q + '%'}` : ilike(issues.title, `%${q}%`))

  const rows = await db
    .select({ number: issues.number, title: issues.title, status: issues.status })
    .from(issues)
    .where(and(...conds))
    .orderBy(desc(issues.number))
    .limit(8)
  return Response.json(rows)
}
