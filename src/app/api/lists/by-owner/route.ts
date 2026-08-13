import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/shared/auth/session'
import { searchTemplatesByOwnerHandle } from '@/features/library/queries'
import { listVisibilityState } from '@/features/library/list-visibility'

// Списки автора для переключателя в бредкрамбе шапки: открыт список человека —
// показываем и ищем по ЕГО спискам. Приватные видит только он сам: гейт — единый
// visibleFilter(viewerId), viewer берётся из сессии, а не из запроса.
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const handle = searchParams.get('h')
  if (!handle) return NextResponse.json({ items: [] })
  const session = await getSession()
  const rows = await searchTemplatesByOwnerHandle(handle, session?.userId, searchParams.get('q') ?? '', 20)
  return NextResponse.json(
    {
      items: rows.map((l) => ({
        handle: l.ownerHandle,
        slug: l.slug,
        title: l.title,
        avatarUrl: l.ownerAvatarUrl,
        // Состояние, а не поле visibility: у черновика оно про будущее, и в
        // переключателе он получал бы значок «публичный» (list-visibility).
        visibility: listVisibilityState(l),
      })),
    },
    // no-store, а НЕ private+max-age: в ответе есть приватные списки владельца, и
    // браузер переиспользовал бы его после логаута/смены аккаунта — чужая сессия
    // увидела бы приватные названия и слаги (замечание авто-ревью #589).
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
