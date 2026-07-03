import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getListMeta } from '@/features/library/queries'
import { gitCore } from '@/features/git/core'

// GET /{handle}/{slug}/repo.bundle — git-бандл всей истории версий.
// Клонируется: `curl -O <url> && git clone <slug>.bundle`.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [meta, viewer] = await Promise.all([getListMeta(handle, slug), getSession()])
  if (!meta) return new Response('Not found', { status: 404 })
  const isOwner = viewer?.userId === meta.ownerId
  const isOwnerOrAdmin = isOwner || isAdminHandle(viewer?.handle)
  if (meta.visibility === 'private' && !isOwner) return new Response('Not found', { status: 404 })
  if (meta.status === 'draft' && !isOwner) return new Response('Not found', { status: 404 })
  if (meta.moderation !== 'active' && !isOwnerOrAdmin) return new Response('Not found', { status: 404 })

  const buf = await gitCore.bundle({ owner: handle, slug })
  if (!buf) return new Response('Could not build bundle', { status: 500 })
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${slug}.bundle"`,
    },
  })
}
