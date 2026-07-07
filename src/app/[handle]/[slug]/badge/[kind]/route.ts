import { getListMeta } from '@/features/library/queries'
import { badgeFor, isBadgeKind } from '@/features/badges/svg'

// GET /{handle}/{slug}/badge/{stars|forks|runs|version}.svg — SVG-шилд для README.
// Только публичные списки (анонимный ассет). Кэш 5 мин, как у shields.io.
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; slug: string; kind: string }> }) {
  const { handle, slug, kind: raw } = await params
  const kind = raw.replace(/\.svg$/, '')
  if (!isBadgeKind(kind)) return new Response('Unknown badge', { status: 404 })
  const meta = await getListMeta(handle, slug)
  // Публичный + опубликованный + не снят модерацией: иначе бейдж выдавал счётчики
  // (и факт существования) черновика/flagged/hidden списка анониму.
  if (!meta || meta.visibility !== 'public' || meta.status !== 'published' || meta.moderation !== 'active')
    return new Response('Not found', { status: 404 })

  const svg = badgeFor(kind, {
    starsCount: meta.starsCount,
    forksCount: meta.forksCount,
    runsCount: meta.runsCount,
    version: meta.currentVersion,
  })
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Короткий кэш: сокращает окно, в которое CDN отдаёт бейдж уже снятого списка.
      'cache-control': 'public, max-age=60, s-maxage=60',
    },
  })
}
