import 'server-only'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { canViewList } from '@/core'
import { isCollaborator } from '@/features/collab/queries'
import { getListMeta, getTemplateDetail } from './queries'

// «Безопасно по умолчанию» для ЧТЕНИЯ списка: загрузка + проверка видимости атомарно.
// Сырые getListMeta/getTemplateDetail отдают данные БЕЗ фильтра, и каждая страница обязана
// сама вспомнить про canViewList — забытый вызов = утечка (так родились дыры blame/versions/
// insights). Эти обёртки возвращают данные ТОЛЬКО если текущий зритель вправе их видеть,
// иначе null → вызывающий делает notFound(). Приватное/черновик/снятое модерацией не утекает.

/** Статус коллаборатора нужен ТОЛЬКО чтобы пустить его к приватному/черновику —
 *  не гоняем лишний запрос на каждый публичный список. */
async function collabIfNeeded(
  list: { visibility: string; status: string; ownerId: string; id: string },
  viewerId?: string,
): Promise<boolean> {
  if (!viewerId || viewerId === list.ownerId) return false
  if (list.visibility !== 'private' && list.status !== 'draft') return false
  return isCollaborator(list.id, viewerId)
}

/** meta списка, если зритель вправе его видеть; иначе null (→ notFound). */
export async function requireViewableMeta(owner: string, slug: string) {
  const meta = await getListMeta(owner, slug)
  if (!meta) return null
  const viewer = await getSession()
  const isOwner = meta.ownerId === viewer?.userId
  const ok = canViewList(meta, {
    isOwner,
    isCollaborator: isOwner ? false : await collabIfNeeded(meta, viewer?.userId),
    isAdmin: isAdminHandle(viewer?.handle),
  })
  return ok ? meta : null
}

/** Полный detail (tpl + версии + шаги), если зритель вправе его видеть; иначе null. */
export async function requireViewableDetail(owner: string, slug: string) {
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) return null
  const viewer = await getSession()
  const isOwner = detail.tpl.ownerId === viewer?.userId
  const ok = canViewList(detail.tpl, {
    isOwner,
    isCollaborator: isOwner ? false : await collabIfNeeded(detail.tpl, viewer?.userId),
    isAdmin: isAdminHandle(viewer?.handle),
  })
  return ok ? detail : null
}
