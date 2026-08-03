// eslint-disable-next-line no-restricted-imports -- анонимный ассет: гейт isPubliclyVisible (строже canViewList), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { isPubliclyVisible } from '@/core'
import { badgeFor, isBadgeKind } from '@/features/badges/svg'
import { cacheHeaders, noStoreHeaders, notModified } from '@/shared/http/cache'

// GET /{handle}/{slug}/badge/{stars|forks|runs|version}.svg — SVG-шилд для README.
// Только публичные списки (анонимный ассет).
export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string; kind: string }> }) {
  const { handle, slug, kind: raw } = await params
  const kind = raw.replace(/\.svg$/, '')
  // Отказ хранить нельзя: добавленный позже вид бейджа и опубликованный позже список
  // иначе какое-то время остаются отрицательно закешированными у чужого прокси.
  if (!isBadgeKind(kind)) return new Response('Unknown badge', { status: 404, headers: noStoreHeaders() })
  const meta = await getListMeta(handle, slug)
  // Публичный + опубликованный + не снят модерацией: иначе бейдж выдавал счётчики
  // (и факт существования) черновика/flagged/hidden списка анониму.
  if (!meta || !isPubliclyVisible(meta)) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const counters = {
    starsCount: meta.starsCount,
    forksCount: meta.forksCount,
    runsCount: meta.runsCount,
    version: meta.currentVersion,
  }
  // Общая политика машинных поверхностей: хранить можно, отдавать без проверки — нет.
  // Окно свежести здесь стоило бы ровно того же, что у остальных: бейдж снятого
  // модерацией списка продолжал бы висеть в чужом README. Трафик экономит ETag —
  // он меняется только вместе со счётчиками, то есть почти всегда 304.
  const etag = `W/"${kind}-${counters.version}-${counters.starsCount}-${counters.forksCount}-${counters.runsCount}"`
  const headers = { 'content-type': 'image/svg+xml; charset=utf-8', ...cacheHeaders({ shared: true, etag }) }

  const cached = notModified(req, etag, headers)
  if (cached) return cached

  return new Response(badgeFor(kind, counters), { headers })
}
