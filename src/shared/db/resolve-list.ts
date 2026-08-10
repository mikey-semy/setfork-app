import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, listRedirects, templates, users } from './index'

/** Поля списка, нужные canViewList и canWriteToFeature (@/core). */
const listProjection = {
  id: templates.id,
  ownerId: templates.ownerId,
  visibility: templates.visibility,
  status: templates.status,
  moderation: templates.moderation,
  issuesEnabled: templates.issuesEnabled,
  discussionsEnabled: templates.discussionsEnabled,
} as const

/** Резолв списка по handle владельца и slug — ровно поля для canViewList и
 *  canWriteToFeature (@/core). Единый лукап для server actions и роутов (был
 *  скопипащен в трёх местах).
 *
 *  Состояние разделов входит в проекцию не «на всякий случай»: без него write-action
 *  физически не может проверить, включён ли раздел, и проверка остаётся только на
 *  странице — то есть там, где сохранённая форма её не встретит.
 *
 *  Прежние адреса тут НЕ учитываются: действие, пришедшее с устаревшего адреса,
 *  должно упереться в отказ, а не молча записать в список. Перенаправлять — дело
 *  чтения, для него есть resolveListOrMoved. */
export async function resolveListBySlug(owner: string, slug: string) {
  const [row] = await db
    .select(listProjection)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return row ?? null
}

export type ResolvedList = NonNullable<Awaited<ReturnType<typeof resolveListBySlug>>>

/**
 * То же, но с прежними адресами: список найден по устаревшему слагу → вернётся
 * `movedTo` с текущим `owner/slug`, и вызывающий обязан перенаправить.
 *
 * Форма — как у Gitea (LookupRedirect в services/context/repo.go): сначала обычный
 * лукап, при промахе — таблица прежних адресов. Совпадение ищется по владельцу
 * ТОГО ВРЕМЕНИ (адрес принадлежал ему), а текущий адрес берётся у списка сейчас —
 * поэтому старая ссылка доводит и до списка, сменившего владельца.
 */
export async function resolveListOrMoved(
  owner: string,
  slug: string,
): Promise<{ list: ResolvedList; movedTo: string | null } | null> {
  const direct = await resolveListBySlug(owner, slug)
  if (direct) return { list: direct, movedTo: null }

  const [moved] = await db
    .select({ templateId: listRedirects.templateId })
    .from(listRedirects)
    .innerJoin(users, eq(listRedirects.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(listRedirects.slug, slug)))
    .limit(1)
  if (!moved) return null

  const [row] = await db
    .select({ ...listProjection, ownerHandle: users.handle, slug: templates.slug })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(templates.id, moved.templateId))
    .limit(1)
  // Список удалён — записи прежних адресов уходят каскадом, так что это гонка, а не
  // штатный случай: отвечаем «нет списка», а не ведём в никуда.
  if (!row) return null

  const { ownerHandle, slug: currentSlug, ...list } = row
  return { list, movedTo: `/${ownerHandle}/${currentSlug}` }
}
