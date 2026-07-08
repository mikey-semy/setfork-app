import { eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { canViewList } from '@/core'
import { isBot, recordClick, visitorKey } from '@/features/analytics/service'
import { clientIp, rateLimit } from '@/shared/rate-limit'

// Исходящий редирект по ref-ссылке шага: /api/go/<stepId>/<refIndex> → 302 на
// внешний url. URL резолвится ТОЛЬКО из контента шага (никаких url в query) —
// open-redirect исключён by design. Попутно журналим клик (link_clicks) —
// фундамент партнёрской аналитики; владельца и ботов не пишем, сбой журнала
// редирект не ломает.
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new Response('Not found', { status: 404 })

export async function GET(req: Request, ctx: { params: Promise<{ step: string; ref: string }> }) {
  const { step: stepId, ref } = await ctx.params
  const refIndex = Number(ref)
  if (!UUID_RE.test(stepId) || !Number.isInteger(refIndex) || refIndex < 0 || refIndex > 999) return notFound()

  const [row] = await db
    .select({
      refs: steps.refs,
      templateId: templateVersions.templateId,
      ownerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(steps)
    .innerJoin(templateVersions, eq(steps.versionId, templateVersions.id))
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(eq(steps.id, stepId))
    .limit(1)
  if (!row) return notFound()

  const url = row.refs[refIndex]?.url
  if (!url || !/^https?:\/\//i.test(url)) return notFound()

  const viewer = await getSession()
  const isOwner = viewer?.userId === row.ownerId
  if (!canViewList(row, { isOwner, isAdmin: isAdminHandle(viewer?.handle) })) return notFound()

  // Журналим клик best-effort: боты и владелец — мимо; при шторме (rate limit)
  // журнал пропускаем, но редиректим всегда — UX важнее строки статистики.
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent')
  if (!isBot(ua) && !isOwner && rateLimit(`go:${ip}`, 120, 60_000).ok) {
    await recordClick({
      templateId: row.templateId,
      stepId,
      refIndex,
      url,
      userId: viewer?.userId ?? null,
      visitor: visitorKey(viewer?.userId, ip, ua),
    }).catch(() => {})
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}
