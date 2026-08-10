import 'server-only'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { permanentRedirectTo } from '@/shared/db/moved-list'
import { resolveListOrMoved } from '@/shared/db/resolve-list'
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

/**
 * Перенаправить на новый адрес — но ТОЛЬКО если список виден этому зрителю.
 *
 * Здесь мы строже Gitea: там перенаправление отдаётся безусловно, и по старому адресу
 * можно узнать текущее имя списка и сам факт его существования — даже если он с тех пор
 * стал приватным, черновиком или снят модерацией. У нас такая цель ведёт себя как
 * отсутствующая, как и на всей остальной поверхности.
 *
 * Живёт в guard, а не в shared: решение опирается на соавторство и админство, а
 * shared про фичи знать не может.
 */
async function redirectMovedIfVisible(owner: string, slug: string): Promise<void> {
  const moved = await resolveListOrMoved(owner, slug)
  if (!moved?.movedTo) return
  const viewer = await getSession()
  const isOwner = moved.list.ownerId === viewer?.userId
  const visible = canViewList(moved.list, {
    isOwner,
    isCollaborator: isOwner ? false : await collabIfNeeded(moved.list, viewer?.userId),
    isAdmin: isAdminHandle(viewer?.handle),
  })
  if (visible) await permanentRedirectTo(`/${owner}/${slug}`, moved.movedTo)
}

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

/**
 * meta списка, если зритель вправе его видеть; иначе null (→ notFound).
 *
 * Мемоизировано НА ЗАПРОС (`cache` из React). Layout любой вкладки списка рисует шапку и
 * зовёт этот guard, следом его зовёт сама страница — то есть каждое открытие стоило двух
 * одинаковых чтений меты, а на приватном пути ещё и повторного лукапа соавторства
 * (карточка ревью forks/010, корень K02 — шесть карточек реестра).
 *
 * Безопасность не страдает: решение зависит от меты и сессии, а сессия внутри одного
 * запроса не меняется. Кеш не переживает запрос и не смешивает разные `owner/slug`.
 */
export const requireViewableMeta = cache(async (owner: string, slug: string) => {
  const meta = await getListMeta(owner, slug)
  // Промах может означать не «нет списка», а «список переехал»: адрес меняли, а
  // ссылка осталась старой. Перенаправление бросает исключение (как notFound), так
  // что до `return null` доходят только по-настоящему несуществующие адреса.
  if (!meta) {
    await redirectMovedIfVisible(owner, slug)
    return null
  }
  const viewer = await getSession()
  const isOwner = meta.ownerId === viewer?.userId
  const ok = canViewList(meta, {
    isOwner,
    isCollaborator: isOwner ? false : await collabIfNeeded(meta, viewer?.userId),
    isAdmin: isAdminHandle(viewer?.handle),
  })
  return ok ? meta : null
})

/** Полный detail (tpl + версии + шаги), если зритель вправе его видеть; иначе null. */
export async function requireViewableDetail(owner: string, slug: string) {
  const viewer = await getSession()
  return viewableDetailFor(owner, slug, viewer?.userId, viewer?.handle)
}

/**
 * То же, но зритель задан ЯВНО — для транспортов без куки (API-токен на /data.json).
 * Хендл нужен только для админ-проверки; у токена его нет, и админом он не считается:
 * машинному ключу не место в обходе видимости.
 */
export async function requireViewableDetailFor(owner: string, slug: string, viewerId: string) {
  return viewableDetailFor(owner, slug, viewerId, undefined)
}

async function viewableDetailFor(owner: string, slug: string, viewerId?: string, viewerHandle?: string | null) {
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) {
    await redirectMovedIfVisible(owner, slug)
    return null
  }
  const isOwner = detail.tpl.ownerId === viewerId
  const ok = canViewList(detail.tpl, {
    isOwner,
    isCollaborator: isOwner ? false : await collabIfNeeded(detail.tpl, viewerId),
    isAdmin: isAdminHandle(viewerHandle),
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
