import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { requireViewableMeta } from '@/features/library/guard'

// Title текущего списка для бредкрамба в топ-баре (клиентский TopNav дёргает по
// смене пути). Авторизация — тот же чокпоинт requireViewableMeta (canViewList):
// приватный / черновик / снятый модерацией title не-владельцу НЕ отдаём.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const handle = searchParams.get('h')
  const slug = searchParams.get('s')
  if (!handle || !slug) return NextResponse.json({ title: null })
  const meta = await requireViewableMeta(handle, slug)
  return NextResponse.json({ title: meta?.title ?? null }, { headers: { 'Cache-Control': 'private, max-age=30' } })
}
