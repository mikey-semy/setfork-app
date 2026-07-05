import { getListMeta } from '@/features/library/queries'
import { badgeFor, isBadgeKind } from '@/features/badges/svg'

// GET /{handle}/{slug}/badge/{stars|forks|runs|version}.svg — SVG-шилд для README.
// Только публичные списки (анонимный ассет). Кэш 5 мин, как у shields.io.
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; slug: string; kind: string }> }) {
  const { handle, slug, kind: raw } = await params
  const kind = raw.replace(/\.svg$/, '')
  if (!isBadgeKind(kind)) return new Response('Unknown badge', { status: 404 })
  const meta = await getListMeta(handle, slug)
  if (!meta || meta.visibility !== 'public') return new Response('Not found', { status: 404 })

  const svg = badgeFor(kind, {
    starsCount: meta.starsCount,
    forksCount: meta.forksCount,
    runsCount: meta.runsCount,
    version: meta.currentVersion,
  })
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  })
}
