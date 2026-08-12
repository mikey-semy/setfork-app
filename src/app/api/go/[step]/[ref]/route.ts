import { eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { applyAffiliate, canViewList } from '@/core'
import { productItems } from '@/features/library/blocks'
import { isBot, recordClick, visitorKey } from '@/features/analytics/service'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { clientIp, rateLimit } from '@/shared/rate-limit'
import { redirectLocation } from '@/shared/lib/safe-url'

// Исходящий редирект по ссылке шага: /api/go/<stepId>/<refIndex> (refs шага)
// или /api/go/<stepId>/p<idx> (товар product-блока) → 302 на внешний url.
// URL резолвится ТОЛЬКО из контента шага (никаких url в query) — open-redirect
// исключён by design. Попутно журналим клик (link_clicks) — фундамент
// партнёрской аналитики; владельца и ботов не пишем, сбой журнала редирект
// не ломает.
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new Response('Not found', { status: 404 })

export async function GET(req: Request, ctx: { params: Promise<{ step: string; ref: string }> }) {
  const { step: stepId, ref } = await ctx.params
  const isProduct = ref.startsWith('p')
  const refIndex = Number(isProduct ? ref.slice(1) : ref)
  if (!UUID_RE.test(stepId) || !Number.isInteger(refIndex) || refIndex < 0 || refIndex > 999) return notFound()

  const [row] = await db
    .select({
      refs: steps.refs,
      type: steps.type,
      content: steps.content,
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

  // p<idx> ссылается на ИСХОДНЫЙ индекс content.items (productItems его сохраняет).
  const url = isProduct
    ? row.type === 'product'
      ? productItems(row.content).find((p) => p.idx === refIndex)?.url
      : undefined
    : row.refs[refIndex]?.url
  if (!url || !/^https?:\/\//i.test(url)) return notFound()

  const viewer = await getSession()
  const isOwner = viewer?.userId === row.ownerId
  if (!canViewList(row, { isOwner, isAdmin: isAdminHandle(viewer?.handle) })) return notFound()

  // Партнёрский тег (правила из админки): подставляем на целевой URL. В журнал
  // пишем итоговый URL — по нему видно, ушёл переход с тегом или без.
  const mon = await getMonetizationSettings()
  const target = mon.affiliateEnabled ? applyAffiliate(url, mon.affiliateRules).url : url
  // Адрес для заголовка: не-ASCII роняет Response (см. redirectLocation). Партнёрское
  // правило проводит URL через конструктор и кодирует его попутно, поэтому падало
  // только на ссылках БЕЗ правила — то есть на обычных.
  const location = redirectLocation(target)
  if (!location) return notFound()

  // Журналим клик best-effort: боты и владелец — мимо; при шторме (rate limit)
  // журнал пропускаем, но редиректим всегда — UX важнее строки статистики.
  // В журнал идёт ТОТ ЖЕ адрес, что и в заголовок: иначе один переход копился бы
  // в статистике двумя видами одной ссылки.
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent')
  if (!isBot(ua) && !isOwner && (await rateLimit(`go:${ip}`, 120, 60_000)).ok) {
    await recordClick({
      templateId: row.templateId,
      stepId,
      refIndex,
      url: location,
      userId: viewer?.userId ?? null,
      visitor: visitorKey(viewer?.userId, ip, ua),
    }).catch(() => {})
  }

  return new Response(null, {
    status: 302,
    headers: {
      location,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}
