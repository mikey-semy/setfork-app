import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { requireViewableMeta } from '@/features/library/guard'
import { listVisibilityState } from '@/shared/list-visibility'

// Title и приватность текущего списка для бредкрамба в топ-баре (клиентский TopNav
// дёргает по смене пути). Авторизация — тот же чокпоинт requireViewableMeta
// (canViewList): приватный / черновик / снятый модерацией title не-владельцу НЕ
// отдаём — а значит и замок видит только тот, кому список вообще доступен.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const handle = searchParams.get('h')
  const slug = searchParams.get('s')
  if (!handle || !slug) return NextResponse.json({ title: null })
  const meta = await requireViewableMeta(handle, slug)
  // no-store, а НЕ private+max-age: ответ зависит от СЕССИИ — владельцу отдаётся
  // название приватного списка и признак приватности. С max-age браузер имеет право
  // переиспользовать его после выхода или смены аккаунта, и чужая сессия увидела бы
  // приватное название. Тот же класс утечки уже закрывали в /api/lists/by-owner.
  // Отдаём СОСТОЯНИЕ (черновик/приватный/публичный), а не поле visibility: у
  // черновика оно говорит лишь о будущем, и крамб рисовал бы глобус «публичный»
  // над списком, которого никто не видит.
  return NextResponse.json(
    { title: meta?.title ?? null, visibility: meta ? listVisibilityState(meta) : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
