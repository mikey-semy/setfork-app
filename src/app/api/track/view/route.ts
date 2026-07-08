import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { canViewList } from '@/features/library/access'
import { isBot, recordView, visitorKey } from '@/features/analytics/service'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import { crossOriginBlock } from '@/shared/csrf'

// Маячок просмотра со страницы списка (sendBeacon → text/plain, парсим вручную).
// Пишем уникальный ДНЕВНОЙ просмотр; владельца и ботов не считаем. Всегда 204 —
// клиенту результат не нужен, детали не раскрываем.
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const noContent = () => new Response(null, { status: 204 })

export async function POST(req: Request) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked

  const ip = clientIp(req)
  const rl = rateLimit(`track-view:${ip}`, 120, 60_000)
  if (!rl.ok) return tooMany(rl)

  const ua = req.headers.get('user-agent')
  if (isBot(ua)) return noContent()

  let templateId = ''
  try {
    const body = JSON.parse(await req.text()) as { t?: unknown }
    if (typeof body.t === 'string') templateId = body.t
  } catch {
    return noContent()
  }
  if (!UUID_RE.test(templateId)) return noContent()

  const [tpl] = await db
    .select({ ownerId: templates.ownerId, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!tpl) return noContent()

  const viewer = await getSession()
  const isOwner = viewer?.userId === tpl.ownerId
  // Владелец не накручивает свои просмотры; невидимые зрителю списки не считаем.
  if (isOwner || !canViewList(tpl, { isOwner, isAdmin: isAdminHandle(viewer?.handle) })) return noContent()

  await recordView(templateId, viewer?.userId ?? null, visitorKey(viewer?.userId, ip, ua)).catch(() => {})
  return noContent()
}
