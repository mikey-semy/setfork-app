import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { canViewList } from '@/core'
import { collaborators, db, issues, notifications, templates, users } from '@/shared/db'
import { cursorKey, keysetPage, keysetStep } from '@/shared/db/keyset'
import type { LocaleText } from '@/shared/i18n'
import { probeLimit, type Cursor, type FeedDirection } from '@/shared/lib/paging'
import { avatarSrc } from '@/shared/media'

export type NotificationType =
  | 'suggestion_new'
  | 'suggestion_accepted'
  | 'suggestion_edited'
  | 'suggestion_rejected'
  | 'suggestion_comment'
  | 'issue_new'
  | 'issue_comment'
  | 'issue_closed_by_merge'
  | 'new_version'
  | 'star'
  | 'fork'
  | 'follow'
  | 'mention'
  | 'assigned'
  | 'review_requested'
  | 'review_dismissed'
  | 'transfer_incoming'
  | 'transfer_accepted'
  | 'transfer_declined'

export interface NotificationItem {
  id: string
  type: NotificationType
  read: boolean
  createdAt: Date
  actorHandle: string | null
  actorAvatarUrl: string | null
  ownerHandle: string | null
  slug: string | null
  title: LocaleText | null
  issueNumber: number | null
  suggestionId: string | null
}

/** Включены ли у пользователя браузерные уведомления (для монтирования нотификатора). */
export async function getBrowserNotifyEnabled(userId: string): Promise<boolean> {
  const [u] = await db.select({ prefs: users.notifyPrefs }).from(users).where(eq(users.id, userId)).limit(1)
  return (u?.prefs as { browser?: boolean } | undefined)?.browser === true
}

/**
 * Счётчик непрочитанного — по ТЕМ ЖЕ правилам видимости, что и сама лента. Иначе бейдж
 * показывал бы «3», а лента открывалась пустой: уведомления про списки, которые зритель
 * больше не видит, из неё выпадают. Заодно счётчик перестаёт быть сигналом «в том
 * приватном списке что-то произошло».
 *
 * Считаем по строкам, а не count(*): предикат доступа один на всё приложение
 * (canViewList), и дублировать его в SQL значит однажды с ним разойтись.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await keepVisible(userId, await fetchNotifications(userId, UNREAD_SCAN_LIMIT))
  return rows.filter((r) => !r.read).length
}

/** Сколько строк смотрим для счётчика: лента и так не бесконечная, а перебор нужен
 *  ради единого предиката доступа. */
const UNREAD_SCAN_LIMIT = 500

/**
 * СЫРЫЕ строки ленты — без отсева видимости.
 *
 * Отсев вынесен отдельно СОЗНАТЕЛЬНО: смешанные вместе, они рвали листание. Разведчик
 * берёт на строку больше показанного, чтобы ответить «есть ли дальше»; если фильтр
 * успевал убрать именно эту строку, ответом становилось «дальше ничего», и лента
 * ОБРЫВАЛАСЬ на середине. Проверено 19.08: шесть уведомлений, одно скрытое на границе,
 * порция по три — показаны три строки и «дальше нет», а два видимых уведомления
 * оказывались недостижимы вовсе.
 */
async function fetchNotifications(
  userId: string,
  limit: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
) {
  // Порядок показа — свежее сверху; направление шага задаёт вызывающий.
  const step = keysetStep(notifications.createdAt, notifications.id, cursor, { order: 'desc', dir })
  const actor = alias(users, 'actor')
  const owner = alias(users, 'owner')
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      read: notifications.read,
      createdAt: notifications.createdAt,
      // Ключ курсора — ТЕКСТОМ из базы. Из `createdAt` его строить нельзя: drizzle
      // отдаёт колонку JS-датой, то есть без микросекунд (см. shared/db/keyset).
      cursorKey: cursorKey(notifications.createdAt),
      actorHandle: actor.handle,
      actorAvatarUrl: actor.avatarUrl,
      ownerHandle: owner.handle,
      slug: templates.slug,
      title: templates.title,
      issueNumber: issues.number,
      suggestionId: notifications.suggestionId,
      templateId: notifications.templateId,
      listOwnerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(notifications)
    .leftJoin(actor, eq(notifications.actorId, actor.id))
    .leftJoin(templates, eq(notifications.templateId, templates.id))
    .leftJoin(owner, eq(owner.id, templates.ownerId))
    .leftJoin(issues, eq(notifications.issueId, issues.id))
    .where(and(eq(notifications.recipientId, userId), step.where))
    // Условие и порядок берутся ОДНИМ шагом: порознь они могли бы смотреть в разные
    // стороны, и запрос молча отдавал бы хвост ленты вместо соседней порции. Заодно
    // порядок доопределён до `id` — раньше здесь стоял один `createdAt desc`, а у пачки
    // уведомлений от одной операции время совпадает, и порядок между ними был произволен.
    .orderBy(...step.order)
    .limit(limit)

  return rows
}

type RawNotification = Awaited<ReturnType<typeof fetchNotifications>>[number]

/** Отсев по видимости списка — ПОСЛЕ того, как порция уже нарезана (см. fetchNotifications). */
async function keepVisible(userId: string, rows: RawNotification[]): Promise<RawNotification[]> {
  // Соредакторство спрашиваем ОДНИМ запросом на всю порцию: приватный список виден и тем,
  // кто ведёт его вместе с владельцем.
  const listIds = [...new Set(rows.map((r) => r.templateId).filter((v): v is string => !!v))]
  const collab = new Set(
    listIds.length
      ? (
          await db
            .select({ templateId: collaborators.templateId })
            .from(collaborators)
            .where(and(eq(collaborators.userId, userId), inArray(collaborators.templateId, listIds)))
        ).map((r) => r.templateId)
      : [],
  )

  return rows.filter((r) => {
    // Уведомление без списка (подписка на человека, передача аккаунта) — не про доступ.
    if (!r.templateId || !r.visibility || !r.status || !r.moderation) return true
    return canViewList(
      { visibility: r.visibility, status: r.status, moderation: r.moderation },
      { isOwner: r.listOwnerId === userId, isCollaborator: collab.has(r.templateId) },
    )
  })
}

/**
 * Лента уведомлений ЗРИТЕЛЯ, отфильтрованная по видимости списка.
 *
 * Строка уведомления живёт вечно, а видимость списка меняется: уведомление пришло, пока
 * список был публичным, потом список закрыли (или сняли модерацией) — и лента продолжала
 * показывать ЕГО ТЕКУЩИЕ заголовок и слаг, потому что join брал актуальную строку
 * templates без проверки доступа. Приватные переименования читались бывшим наблюдателем
 * прямо из своей ленты (P1 из авто-ревью).
 *
 * Уведомление про невидимый сейчас список выпадает целиком — не «прячем заголовок»: сам
 * факт «в этом списке что-то произошло» тоже часть приватного.
 */
export async function getNotifications(userId: string, limit = 50): Promise<NotificationItem[]> {
  return toItems(await keepVisible(userId, await fetchNotifications(userId, limit)))
}

const toItems = (rows: RawNotification[]): Promise<NotificationItem[]> =>
  Promise.all(
    rows.map(
      async ({ templateId: _t, listOwnerId: _o, visibility: _v, status: _s, moderation: _m, cursorKey: _k, ...r }) => ({
        ...r,
        actorAvatarUrl: await avatarSrc(r.actorAvatarUrl, 64),
      }),
    ),
  ) as Promise<NotificationItem[]>

/**
 * ПОРЦИЯ ЛЕНТЫ УВЕДОМЛЕНИЙ — листается КЛЮЧОМ, а не номером страницы.
 *
 * Уведомления прилетают сверху постоянно, и это тот самый случай, где смещение даёт не
 * медленную выдачу, а неверную: пока читают вторую порцию, начало отсчёта уезжает вниз, и
 * строка с границы либо пропадает, либо приходит дважды. Прыжок на «страницу 7» здесь и
 * не нужен — ленту читают сверху вниз.
 *
 * Края считаются по СЫРЫМ строкам, до отсева видимости, и это несущая деталь. Видимость
 * решает `canViewList` в приложении (предикат один на всё приложение; дублировать его в
 * SQL — однажды с ним разойтись), поэтому порция может ПОКАЗАТЬ меньше строк, чем взяла.
 * Считать «дальше есть» по показанным нельзя: скрытая строка на границе съедала бы ответ
 * разведчика, и лента обрывалась бы на середине. Ровно это и происходило, пока отсев
 * стоял внутри запроса.
 *
 * Плата за это — порции разной высоты. Убрать её можно только перенеся предикат доступа
 * в SQL; это отдельное решение, а не побочный эффект перевода на keyset.
 *
 * ОТКУДА БЕРЁТСЯ ПРОТИВОПОЛОЖНЫЙ КРАЙ. Разведчик отвечает только про ту сторону, в
 * которую шагнули. Про другую спрашивать базу не нужно: если мы пришли шагом «вниз» с
 * курсором, значит выше что-то есть — мы оттуда и приехали. Второй запрос ради того, что
 * и так известно из адреса, — лишняя работа на каждый показ ленты.
 */
export async function getNotificationsPage(
  userId: string,
  perPage: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
): Promise<{ items: NotificationItem[]; next: string | null; prev: string | null }> {
  // Без курсора шага вверх не существует: «перед началом» — не место. Иначе порядок `asc`
  // без условия отдал бы САМЫЕ СТАРЫЕ уведомления, и лента открывалась бы с конца.
  const up = dir === 'before' && cursor !== null
  const raw = await fetchNotifications(userId, probeLimit(perPage), cursor, up ? 'before' : 'after')
  // Курсоры строятся по ВЗЯТЫМ строкам, а не по показанным: иначе скрытая строка на
  // границе перечитывалась бы бесконечно.
  const { shown, next, prev } = keysetPage(raw, perPage, cursor, { reverse: up })
  // Отсев — ПОСЛЕ нарезки: края уже посчитаны по сырым строкам, и скрытая строка их не
  // трогает. Плата — порции разной высоты; см. выше, почему это принято.
  return { items: await toItems(await keepVisible(userId, shown)), next, prev }
}

