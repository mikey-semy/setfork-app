import 'server-only'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { canViewList } from '@/core'
import { getListMeta, getTemplateDetail } from './queries'

// «Безопасно по умолчанию» для ЧТЕНИЯ списка: загрузка + проверка видимости атомарно.
// Сырые getListMeta/getTemplateDetail отдают данные БЕЗ фильтра, и каждая страница обязана
// сама вспомнить про canViewList — забытый вызов = утечка (так родились дыры blame/versions/
// insights). Эти обёртки возвращают данные ТОЛЬКО если текущий зритель вправе их видеть,
// иначе null → вызывающий делает notFound(). Приватное/черновик/снятое модерацией не утекает.

/** meta списка, если зритель вправе его видеть; иначе null (→ notFound). */
export async function requireViewableMeta(owner: string, slug: string) {
  const meta = await getListMeta(owner, slug)
  if (!meta) return null
  const viewer = await getSession()
  const ok = canViewList(meta, { isOwner: meta.ownerId === viewer?.userId, isAdmin: isAdminHandle(viewer?.handle) })
  return ok ? meta : null
}

/** Полный detail (tpl + версии + шаги), если зритель вправе его видеть; иначе null. */
export async function requireViewableDetail(owner: string, slug: string) {
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) return null
  const viewer = await getSession()
  const ok = canViewList(detail.tpl, { isOwner: detail.tpl.ownerId === viewer?.userId, isAdmin: isAdminHandle(viewer?.handle) })
  return ok ? detail : null
}
