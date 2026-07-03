import { and, desc, eq, ilike, sql } from 'drizzle-orm'
import { getSession } from '@/shared/auth/session'
import { db, issues, templates, users } from '@/shared/db'
import { rateLimit, tooMany } from '@/shared/rate-limit'

// Поиск issue репо для #-reference в редакторе. Только залогиненным.
// q числовой → по номеру (префикс); иначе → по заголовку; пусто → последние.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json([])
  const rl = rateLimit(`isearch:${session.userId}`, 60, 60_000)
  if (!rl.ok) return tooMany(rl)

  const url = new URL(req.url)
  const owner = url.searchParams.get('owner') ?? ''
  const slug = url.searchParams.get('slug') ?? ''
  const q = (url.searchParams.get('q') ?? '').trim()

  const [tpl] = await db
    .select({ id: templates.id })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  if (!tpl) return Response.json([])

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
