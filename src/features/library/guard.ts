import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { canEditList, canRunList, canViewList, editBlockReason } from '@/core'
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

// ── Guard записи по состоянию (архив/заморозка) ──────────────────────
// Владение проверяют сами actions (owner/collaborator); ЗДЕСЬ — только «можно ли
// вообще менять этот список в его текущем состоянии». Возвращает reason
// ('archived'|'frozen') если писать нельзя, иначе null — вызывающий редиректит/выходит.
// Дешёвая точечная загрузка двух полей (не весь detail).

async function loadState(templateId: string): Promise<{ archivedAt: Date | null; frozenAt: Date | null } | null> {
  const [row] = await db
    .select({ archivedAt: templates.archivedAt, frozenAt: templates.frozenAt })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  return row ?? null
}

/** null — редактировать МОЖНО; иначе причина запрета. */
export async function editBlock(templateId: string): Promise<'archived' | 'frozen' | null> {
  const st = await loadState(templateId)
  if (!st) return null // нет списка — пусть решает вызывающий (обычно и так упадёт)
  return canEditList(st) ? null : editBlockReason(st)
}

/** null — начать прогон МОЖНО; иначе причина (только 'archived'). */
export async function runBlock(templateId: string): Promise<'archived' | null> {
  const st = await loadState(templateId)
  if (!st) return null
  return canRunList(st) ? null : 'archived'
}
