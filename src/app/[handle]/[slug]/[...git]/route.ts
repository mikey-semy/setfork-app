import { rm } from 'node:fs/promises'
import { getListMeta } from '@/features/library/queries'
import { verifyApiToken } from '@/shared/auth/api-token'
import { materializeRepoForList } from '@/features/git/bundle'
import { maybeGunzip, uploadPackAdvertise, uploadPackRpc } from '@/features/git/smart-http'

// git smart-HTTP (read-only): `git clone/pull https://host/{owner}/{slug}.git`.
// Работает из VSCode и любого git-клиента. Push (receive-pack) пока не поддержан.
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

type AuthResult = { ok: true } | { status: 401 | 404 }

async function authorize(req: Request, owner: string, slug: string): Promise<AuthResult> {
  const meta = await getListMeta(owner, slug)
  if (!meta) return { status: 404 }
  const needsAuth = meta.visibility === 'private' || meta.status === 'draft' || meta.moderation !== 'active'
  if (!needsAuth) return { ok: true }
  const userId = await userFromBasic(req)
  if (!userId) return { status: 401 }
  if (userId !== meta.ownerId) return { status: 404 } // приватное — только владельцу
  return { ok: true }
}

function cleanSlug(raw: string): string {
  return raw.replace(/\.git$/, '')
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const { handle, slug: rawSlug, git } = await params
  const path = (git ?? []).join('/')
  if (path !== 'info/refs') return new Response('Not found', { status: 404 })
  const service = new URL(req.url).searchParams.get('service')
  if (service !== 'git-upload-pack') return new Response('Service not available', { status: 403 }) // read-only

  const slug = cleanSlug(rawSlug)
  const az = await authorize(req, handle, slug)
  if ('status' in az) return az.status === 401 ? unauthorized() : new Response('Not found', { status: 404 })

  const repo = await materializeRepoForList(handle, slug)
  if (!repo) return new Response('Repository unavailable', { status: 500 })
  try {
    const body = await uploadPackAdvertise(repo, req.headers.get('git-protocol') ?? undefined)
    return new Response(new Uint8Array(body), {
      headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement', ...noCache },
    })
  } catch {
    return new Response('git error', { status: 500 })
  } finally {
    await rm(repo, { recursive: true, force: true }).catch(() => {})
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const { handle, slug: rawSlug, git } = await params
  const path = (git ?? []).join('/')
  if (path === 'git-receive-pack') return new Response('Push is not supported yet (read-only).', { status: 403 })
  if (path !== 'git-upload-pack') return new Response('Not found', { status: 404 })

  const slug = cleanSlug(rawSlug)
  const az = await authorize(req, handle, slug)
  if ('status' in az) return az.status === 401 ? unauthorized() : new Response('Not found', { status: 404 })

  const repo = await materializeRepoForList(handle, slug)
  if (!repo) return new Response('Repository unavailable', { status: 500 })
  try {
    const raw = Buffer.from(await req.arrayBuffer())
    const body = maybeGunzip(raw, req.headers.get('content-encoding'))
    const out = await uploadPackRpc(repo, body, req.headers.get('git-protocol') ?? undefined)
    return new Response(new Uint8Array(out), {
      headers: { 'Content-Type': 'application/x-git-upload-pack-result', ...noCache },
    })
  } catch {
    return new Response('git error', { status: 500 })
  } finally {
    await rm(repo, { recursive: true, force: true }).catch(() => {})
  }
}
