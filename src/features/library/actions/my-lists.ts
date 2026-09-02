'use server'

import { requireSession } from '@/shared/auth/session'
import { DASHBOARD_LISTS, pageWindow } from '@/shared/lib/paging'
import { countUserTemplates, getUserTemplates, searchTemplatesByOwnerHandle } from '../queries'
import { listVisibilityState } from '@/shared/list-visibility'

const panelItem = (l: Awaited<ReturnType<typeof getUserTemplates>>[number]) => ({
  handle: l.ownerHandle,
  slug: l.slug,
  title: l.title,
  avatarUrl: l.ownerAvatarUrl,
  visibility: listVisibilityState(l),
})

/**
 * СТРАНИЦА своих списков для панели дашборда: окно `limit` строк от `offset`.
 *
 * Отдельным экшеном, а не «прислать всё сразу»: у владельца 518 списков, и до
 * 13.08.2026 дашборд грузил их целиком, чтобы показать пять. Панель этим окном
 * ЗАМЕНЯЕТ показанное, поэтому и на 518 списках в ней остаётся одна страница.
 *
 * Своё берём по СЕССИИ, а не по переданному id: чужой набор так не запросить.
 */
export async function loadMyLists(offset: number, limit: number) {
  const session = await requireSession()
  // ПОТОЛОК ОБЯЗАТЕЛЕН: это серверный экшен, то есть точка входа, доступная браузеру
  // напрямую, а не только через панель. `feedWindow` проверяет, что окно — целое
  // положительное, но верхнего края у него нет: `limit: 5_000_000` вытянул бы всю
  // библиотеку вместе с подписью картинки на каждую строку, а `offset: 1e300` прошёл бы
  // проверку и уронил запрос уже в базе. Панель просит ровно страницу, всё сверх неё —
  // не наш вызов.
  const size = Math.min(Math.max(1, Math.floor(limit) || DASHBOARD_LISTS), DASHBOARD_LISTS)
  // Через pageWindow, а не напрямую: у него есть и потолок номера страницы, то есть
  // смещение не может улететь за пределы, которые переварит bigint.
  const rows = await getUserTemplates(session.userId, session.userId, pageWindow(Math.floor(Math.max(0, offset) / size) + 1, size))
  return rows.map(panelItem)
}

/** Поиск панели идёт по всей библиотеке, а не только по семи загруженным строкам. */
export async function searchMyLists(query: string) {
  const session = await requireSession()
  const rows = await searchTemplatesByOwnerHandle(session.handle, session.userId, query, 50)
  return rows.map(panelItem)
}

/** Сколько всего своих списков — панель по нему решает, показывать ли кнопку. */
export async function countMyLists() {
  const session = await requireSession()
  return countUserTemplates(session.userId, session.userId)
}
