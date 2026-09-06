import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { envNumber } from '@/shared/env'
import { db, listRedirects, templates, userRedirects, users } from './index'

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
 * Тот же список, но по id — для тех, у кого адреса на руках нет.
 *
 * Понадобился фоновым писателям: садовник приходит к списку по `template_id` из своей
 * таблицы находок, и просить у него ник владельца значило бы гонять лишний запрос ради
 * того, чтобы тут же разобрать строку обратно. Проекция ОДНА с адресным резолвом:
 * права считаются по одним и тем же полям, кто бы ни пришёл.
 */
export async function resolveListById(templateId: string): Promise<ResolvedList | null> {
  const [row] = await db.select(listProjection).from(templates).where(eq(templates.id, templateId)).limit(1)
  return row ?? null
}

/**
 * Пользователь по нику — текущему или ПРЕЖНЕМУ.
 *
 * Ник стоит первым сегментом в адресе каждого списка человека, поэтому его смена
 * обрывает ссылки не на один список, а на все сразу. Форма — как `user_redirect` в
 * Gitea (models/user/redirect.go): имя → пользователь, сверка без учёта регистра.
 */
export async function resolveUserByHandle(
  handle: string,
): Promise<{ id: string; handle: string; moved: boolean } | null> {
  const [live] = await db
    .select({ id: users.id, handle: users.handle })
    .from(users)
    .where(sql`lower(${users.handle}) = lower(${handle})`)
    .limit(1)
  if (live) return { ...live, moved: false }

  const [previous] = await db
    .select({ id: users.id, handle: users.handle })
    .from(userRedirects)
    .innerJoin(users, eq(userRedirects.userId, users.id))
    .where(and(sql`lower(${userRedirects.handle}) = lower(${handle})`, handleHoldAlive()))
    .limit(1)
  return previous ? { ...previous, moved: true } : null
}

/**
 * Сколько прежний ник продолжает вести на человека, дней.
 *
 * Ники — ресурс ОБЩИЙ и конечный, в отличие от слагов (те заняты только у своего
 * владельца). Держать прежние имена вечно значит навсегда выесть пространство коротких
 * ников; освобождать сразу, как Gitea (DeleteUserRedirect в createUser) и GitHub, —
 * значит рвать чужие ссылки в ту же секунду, когда имя кто-то занял, и молча уводить
 * их на другого человека. Срок — середина: ссылки переживают переезд, имена
 * возвращаются в оборот.
 *
 * Настройкой, а не числом: подходящая величина выяснится по тому, как часто ники
 * меняют и как долго живут ссылки на них.
 */
const HANDLE_HOLD_DAYS = envNumber('SETFORK_HANDLE_HOLD_DAYS', 180)

/** Условие «удержание прежнего ника ещё не истекло» — общее для лукапа и занятости. */
export function handleHoldAlive() {
  return sql`${userRedirects.createdAt} > now() - make_interval(days => ${HANDLE_HOLD_DAYS})`
}

/** Собрать актуальный адрес и понять, отличается ли он от запрошенного. */
function addressOf(row: { ownerHandle: string; slug: string }): string {
  return `/${row.ownerHandle}/${row.slug}`
}

/**
 * Список по адресу с учётом ОБОИХ переездов: сменившегося ника владельца и
 * сменившегося слага. `movedTo` — актуальный `/owner/slug`, если адрес устарел хотя
 * бы одной частью; null — адрес и так актуален.
 *
 * Порядок как у Gitea (services/context/repo.go): сначала обычный лукап, при промахе
 * — прежние имена. Разница в том, что у нас переехать могут обе части адреса разом
 * (человек сменил ник И переименовал список), поэтому владелец и слаг ищутся
 * последовательно, а не одним запросом по паре.
 */
export async function resolveListOrMoved(
  owner: string,
  slug: string,
): Promise<{ list: ResolvedList; movedTo: string | null } | null> {
  const direct = await resolveListBySlug(owner, slug)
  if (direct) return { list: direct, movedTo: null }

  const user = await resolveUserByHandle(owner)
  if (!user) return null

  // Слаг ищем среди списков ЭТОГО владельца: сначала текущий, затем прежний. Владелец
  // мог и не меняться — тогда сюда попадают из-за переименования самого списка.
  const [live] = await db
    .select({ ...listProjection, ownerHandle: users.handle, slug: templates.slug })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(templates.ownerId, user.id), eq(templates.slug, slug)))
    .limit(1)
  if (live) {
    const { ownerHandle, slug: currentSlug, ...list } = live
    return { list, movedTo: addressOf({ ownerHandle, slug: currentSlug }) }
  }

  const [moved] = await db
    .select({ templateId: listRedirects.templateId })
    .from(listRedirects)
    .where(and(eq(listRedirects.ownerId, user.id), eq(listRedirects.slug, slug)))
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
  return { list, movedTo: addressOf({ ownerHandle, slug: currentSlug }) }
}
