import { getListMeta } from '@/features/library/queries'
import { verifyApiToken } from '@/shared/auth/api-token'
import { gitStore } from '@/features/git/adapter'
import { maybeGunzip } from '@/features/git/smart-http'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'

// git smart-HTTP: `git clone/pull/push https://host/{owner}/{slug}.git`.
// Работает из VSCode. Источник правды — персистентный bare-репо (features/git/store).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noCache = { Expires: 'Fri, 01 Jan 1980 00:00:00 GMT', Pragma: 'no-cache', 'Cache-Control': 'no-cache, max-age=0, must-revalidate' }
const unauthorized = () =>
  new Response('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="SetHub", charset="UTF-8"' } })

async function userFromBasic(req: Request): Promise<string | null> {
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
  const userId = await userFromBasic(req)
  if (!userId) return 401
  return userId === meta.ownerId ? 'ok' : 404
}

/** Доступ на запись (push): только владелец по токену. */
async function authorizeWrite(req: Request, meta: Meta): Promise<'ok' | 401> {
  const userId = await userFromBasic(req)
  if (!userId) return 401
  return userId === meta.ownerId ? 'ok' : 401
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
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
    const bare = await gitStore.ensureRepo({ owner: handle, slug })
    if (!bare) return new Response('Repository unavailable', { status: 500 })
    const body = await gitStore.uploadPackAdvertise(bare, gitProtocol)
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement', ...noCache } })
  }

  if (service === 'git-receive-pack') {
    const az = await authorizeWrite(req, meta)
    if (az !== 'ok') return unauthorized()
    const bare = await gitStore.ensureRepo({ owner: handle, slug })
    if (!bare) return new Response('Repository unavailable', { status: 500 })
    const body = await gitStore.receivePackAdvertise(bare, gitProtocol)
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/x-git-receive-pack-advertisement', ...noCache } })
  }

  return new Response('Service not available', { status: 403 })
}

export async function POST(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const { handle, slug: rawSlug, git } = await params
  const path = (git ?? []).join('/')
  const slug = cleanSlug(rawSlug)
  const meta = await getListMeta(handle, slug)
  if (!meta) return new Response('Not found', { status: 404 })
  const gitProtocol = req.headers.get('git-protocol') ?? undefined

  if (path === 'git-upload-pack') {
    const az = await authorizeRead(req, meta)
    if (az !== 'ok') return az === 401 ? unauthorized() : new Response('Not found', { status: 404 })
    const bare = await gitStore.ensureRepo({ owner: handle, slug })
    if (!bare) return new Response('Repository unavailable', { status: 500 })
    const raw = Buffer.from(await req.arrayBuffer())
    const out = await gitStore.uploadPackRpc(bare, maybeGunzip(raw, req.headers.get('content-encoding')), gitProtocol)
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'application/x-git-upload-pack-result', ...noCache } })
  }

  if (path === 'git-receive-pack') {
    const az = await authorizeWrite(req, meta)
    if (az !== 'ok') return unauthorized()
    const bare = await gitStore.ensureRepo({ owner: handle, slug })
    if (!bare) return new Response('Repository unavailable', { status: 500 })
    const raw = Buffer.from(await req.arrayBuffer())
    const body = maybeGunzip(raw, req.headers.get('content-encoding'))
    // receive-pack + проекция под одним локом (чтобы ленивый append не вклинился).
    const out = await gitStore.withRepoLock(meta.id, async () => {
      const res = await gitStore.receivePackRpc(bare, body, gitProtocol)
      const version = await gitStore.projectPushedCommit(meta.id, bare).catch(() => null)
      if (version != null) {
        const watchers = await getWatcherIds(meta.id)
        await notifyMany(watchers, { type: 'new_version', templateId: meta.id }).catch(() => {})
      }
      return res
    })
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'application/x-git-receive-pack-result', ...noCache } })
  }

  return new Response('Not found', { status: 404 })
}
