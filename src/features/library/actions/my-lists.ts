'use server'

import { requireSession } from '@/shared/auth/session'
import { countUserTemplates, getUserTemplates, searchTemplatesByOwnerHandle } from '../queries'
import { listVisibilityState } from '../list-visibility'

const panelItem = (l: Awaited<ReturnType<typeof getUserTemplates>>[number]) => ({
  handle: l.ownerHandle,
  slug: l.slug,
  title: l.title,
  avatarUrl: l.ownerAvatarUrl,
  visibility: listVisibilityState(l),
})

/**
 * Следующая порция СВОИХ списков для панели дашборда.
 *
 * Отдельным экшеном, а не «прислать всё сразу»: у владельца 518 списков, и до
 * 13.08.2026 дашборд грузил их целиком, чтобы показать пять, — кнопка «Показать
 * ещё» лишь раскрывала уже присланное. Теперь она приносит ровно следующий кусок.
 *
 * Своё берём по СЕССИИ, а не по переданному id: чужой набор так не запросить.
 */
export async function loadMyLists(offset: number, limit: number) {
  const session = await requireSession()
  const rows = await getUserTemplates(session.userId, session.userId, { limit, offset })
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
