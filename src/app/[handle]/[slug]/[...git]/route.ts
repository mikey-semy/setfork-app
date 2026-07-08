// eslint-disable-next-line no-restricted-imports -- git smart-HTTP: своя авторизация (токен/коллаборатор), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { isCollaborator } from '@/features/collab/queries'
import { verifyApiToken } from '@/shared/auth/api-token'
import { gitCore } from '@/features/git/core'
import { maybeGunzip } from '@/features/git/smart-http'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { recordAudit } from '@/shared/audit'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'

// git smart-HTTP: `git clone/pull/push https://host/{owner}/{slug}.git`.
// Работает из VSCode. Источник правды — персистентный bare-репо (features/git/store).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noCache = { Expires: 'Fri, 01 Jan 1980 00:00:00 GMT', Pragma: 'no-cache', 'Cache-Control': 'no-cache, max-age=0, must-revalidate' }
const unauthorized = () =>
  new Response('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="SetFork", charset="UTF-8"' } })

async function userFromBasic(req: Request): Promise<{ userId: string; scope: 'read' | 'write' } | null> {
  const h = req.headers.get('authorization') ?? ''
  if (!h.toLowerCase().startsWith('basic ')) return null
  try {
    const decoded = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8')
    const pass = decoded.slice(decoded.indexOf(':') + 1) // git PAT = пароль (логин любой)
    return await verifyApiToken(pass)
  } catch {
    return null
  }
}

const cleanSlug = (raw: string) => raw.replace(/\.git$/, '')

type Meta = NonNullable<Awaited<ReturnType<typeof getListMeta>>>

/** Доступ на чтение (clone/pull): public — аноним; private/draft — владелец по токену. */
async function authorizeRead(req: Request, meta: Meta): Promise<'ok' | 401 | 404> {
  const needsAuth = meta.visibility === 'private' || meta.status === 'draft' || meta.moderation !== 'active'
  if (!needsAuth) return 'ok'
  const auth = await userFromBasic(req)
  if (!auth) return 401
  return auth.userId === meta.ownerId ? 'ok' : 404
}

/** Доступ на запись (push): владелец/коллаборатор по токену со scope 'write'.
 *  Возвращает userId пушащего (для аудита) или 401. */
async function authorizeWrite(req: Request, meta: Meta): Promise<string | 401> {
  const auth = await userFromBasic(req)
  if (!auth || auth.scope !== 'write') return 401 // read-only токен не может пушить
  if (auth.userId === meta.ownerId) return auth.userId
  return (await isCollaborator(meta.id, auth.userId)) ? auth.userId : 401
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const rl = rateLimit(`git:${clientIp(req)}`, 240, 60_000)
  if (!rl.ok) return tooMany(rl)
  const { handle, slug: rawSlug, git } = await params
  if ((git ?? []).join('/') !== 'info/refs') return new Response('Not found', { status: 404 })
  const service = new URL(req.url).searchParams.get('service')
  const slug = cleanSlug(rawSlug)
  const meta = await getListMeta(handle, slug)
  if (!meta) return new Response('Not found', { status: 404 })
  const gitProtocol = req.headers.get('git-protocol') ?? undefined

  if (service === 'git-upload-pack') {
    const az = await authorizeRead(req, meta)
    if (az !== 'ok') return az === 401 ? unauthorized() : new Response('Not found', { status: 404 })
    const body = await gitCore.infoRefsUploadPack({ owner: handle, slug }, gitProtocol)
    if (!body) return new Response('Repository unavailable', { status: 500 })
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement', ...noCache } })
  }

  if (service === 'git-receive-pack') {
    const az = await authorizeWrite(req, meta)
    if (az === 401) return unauthorized()
    const body = await gitCore.infoRefsReceivePack({ owner: handle, slug }, gitProtocol)
    if (!body) return new Response('Repository unavailable', { status: 500 })
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/x-git-receive-pack-advertisement', ...noCache } })
  }

  return new Response('Service not available', { status: 403 })
}

export async function POST(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const rl = rateLimit(`git:${clientIp(req)}`, 240, 60_000)
  if (!rl.ok) return tooMany(rl)
  const { handle, slug: rawSlug, git } = await params
  const path = (git ?? []).join('/')
  const slug = cleanSlug(rawSlug)
  const meta = await getListMeta(handle, slug)
  if (!meta) return new Response('Not found', { status: 404 })
  const gitProtocol = req.headers.get('git-protocol') ?? undefined

  if (path === 'git-upload-pack') {
    const az = await authorizeRead(req, meta)
    if (az !== 'ok') return az === 401 ? unauthorized() : new Response('Not found', { status: 404 })
    const raw = Buffer.from(await req.arrayBuffer())
    const out = await gitCore.uploadPack({ owner: handle, slug }, maybeGunzip(raw, req.headers.get('content-encoding')), gitProtocol)
    if (!out) return new Response('Repository unavailable', { status: 500 })
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'application/x-git-upload-pack-result', ...noCache } })
  }

  if (path === 'git-receive-pack') {
    const az = await authorizeWrite(req, meta)
    if (az === 401) return unauthorized()
    const raw = Buffer.from(await req.arrayBuffer())
    const body = maybeGunzip(raw, req.headers.get('content-encoding'))
    const res = await gitCore.receivePack({ owner: handle, slug }, body, gitProtocol)
    if (!res) return new Response('Repository unavailable', { status: 500 })
    // Уведомление наблюдателей + аудит — delivery-эффекты, вне git-ядра.
    if (res.newVersion != null) {
      const watchers = await getWatcherIds(meta.id)
      await notifyMany(watchers, { type: 'new_version', templateId: meta.id }).catch(() => {})
      await recordAudit('git.push', { actorId: az, targetType: 'list', targetId: meta.id, meta: { version: res.newVersion, slug } })
      // push меняет title/desc/tags минуя формы → пере-проверяем публичный список в фоне.
      if (meta.visibility === 'public') {
        const { recheckList } = await import('@/features/moderation/moderate-list')
        await recheckList(meta.id).catch(() => {})
      }
    }
    return new Response(new Uint8Array(res.data), { headers: { 'Content-Type': 'application/x-git-receive-pack-result', ...noCache } })
  }

  return new Response('Not found', { status: 404 })
}
