import 'server-only'
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db, starFolderItems, starFolders, stars, templates, users } from '@/shared/db'
import { feedWindow } from '@/shared/lib/paging'
import type { FeedItem } from './list'
import { FEED_COLS, titleText, visibleFilter, withAvatar } from './shared'

/**
 * ВЫДАЧА ВКЛАДОК ПРОФИЛЯ («Списки» и «Звёзды») — отбор, порядок и окно ОДНИМ запросом.
 *
 * До этого правила выдачи жили в приложении (`selectItems`): страница поднимала весь
 * подходящий набор и фильтровала его в памяти. Это работало, но платить приходилось
 * корпусом за экран, и цена росла вместе с библиотекой.
 *
 * Перенос в SQL закрывает и то, чего в памяти не было видно вовсе: ПОРЯДОК СТАЛ
 * ОДНОЗНАЧНЫМ. Сортировка по звёздам оставляет пачки строк с равным счётом, и без
 * доопределения база вправе вернуть их в любом порядке — на соседних страницах это
 * значит, что одна строка показана дважды, а другая не показана ни разу. В памяти
 * этого не случалось только потому, что сортировался один массив целиком. Поэтому у
 * каждого порядка здесь есть хвост-доопределение вплоть до `id`.
 */

export type ProfileListTab = 'lists' | 'starred'
export type ProfileListSort = 'recent' | 'name' | 'stars'
export type ProfileListType = 'all' | 'public' | 'private' | 'forks'

export interface ProfileListFilter {
  /** Чей профиль открыт: владелец списков (`lists`) или хозяин звёзд (`starred`). */
  ownerId: string
  /** Кто смотрит: от него зависит, видны ли приватные и черновики. */
  viewerId?: string
  tab: ProfileListTab
  query?: string
  sort?: ProfileListSort
  listType?: ProfileListType
  /**
   * Полка: id каталога, либо `null` — «без полки» (очередь разбора), либо `undefined` —
   * фильтра нет вовсе. Три состояния, а не два: «не выбрано» и «выбрано отсутствие»
   * это разные вопросы, и сливать их в `null` значило бы показывать очередь разбора
   * всем, кто просто открыл вкладку.
   */
  catalogId?: string | null
  /**
   * Имя папки звёзд. Только для `starred`. Несуществующее имя фильтром НЕ считается —
   * то же правило, что у полки: опечатка в адресе иначе показывает пустую вкладку, и
   * человеку неоткуда узнать, что фильтр вообще применился.
   */
  folder?: string
}

/** Поиск профиля — по названию и слагу, БЕЗ описания: так было в памяти, и так ожидается
 *  на своей библиотеке («ищу свой список», а не «ищу упоминание»). Выражения совпадают с
 *  trgm-индексами (0028_search_fts), иначе ILIKE ушёл бы в seq scan. */
const searchLike = (q: string): SQL => {
  const like = `%${q}%`
  return or(ilike(titleText, like), ilike(templates.slug, like))!
}

const conditions = (f: ProfileListFilter): SQL[] => {
  const c: SQL[] = [visibleFilter(f.viewerId)]
  // Свои списки отбираются по владельцу; звёзды — по строке `stars` (условие ниже, в
  // самом запросе), поэтому здесь владелец добавляется только для вкладки списков.
  if (f.tab === 'lists') c.push(eq(templates.ownerId, f.ownerId))
  const q = f.query?.trim()
  if (q) c.push(searchLike(q))
  if (f.tab === 'lists' && f.listType && f.listType !== 'all') {
    // Форк — это происхождение, а не видимость: их нельзя смешивать в одном поле фильтра.
    c.push(f.listType === 'forks' ? eq(templates.origin, 'forked') : eq(templates.visibility, f.listType))
  }
  if (f.tab === 'lists' && f.catalogId !== undefined) {
    c.push(f.catalogId === null ? isNull(templates.repositoryId) : eq(templates.repositoryId, f.catalogId))
  }
  return c
}

/** Порядок + доопределение до `id`: без него страницы теряют и дублируют строки. */
const ordering = (f: ProfileListFilter): SQL[] => {
  if (f.sort === 'name') {
    // collate "C" — байтовый порядок. Слаги это [a-z0-9-], поэтому он совпадает с тем,
    // что давал localeCompare, зато однозначен и не зависит от локали сервера БД.
    return [asc(sql`${templates.slug} collate "C"`), asc(templates.id)]
  }
  if (f.sort === 'stars') return [desc(templates.starsCount), desc(templates.updatedAt), asc(templates.id)]
  // 'recent': для своих — по обновлению списка, для звёзд — по дате звезды (когда положил).
  return f.tab === 'starred' ? [desc(stars.createdAt), asc(templates.id)] : [desc(templates.updatedAt), asc(templates.id)]
}

/** Папка звёзд → её id. Нет такой папки — `undefined`: фильтра просто нет (см. `folder`). */
async function folderId(ownerId: string, name: string): Promise<string | undefined> {
  const [f] = await db
    .select({ id: starFolders.id })
    .from(starFolders)
    .where(and(eq(starFolders.userId, ownerId), eq(starFolders.name, name)))
    .limit(1)
  return f?.id
}

/**
 * Страница выдачи и сколько всего строк под теми же условиями.
 *
 * Двумя запросами параллельно, а не `count(*) over ()` одним: оконный счёт заставляет
 * базу построить весь отобранный набор, чтобы отдать двадцать строк, — то есть ровно то,
 * от чего мы уходим. Раздельно каждый запрос идёт своим путём: счёт — по индексу,
 * страница — по индексу порядка с ранней остановкой.
 */
export async function getProfileListPage(
  f: ProfileListFilter,
  window: { limit: number; offset?: number },
): Promise<{ items: FeedItem[]; total: number }> {
  const w = feedWindow(window)
  const fid = f.tab === 'starred' && f.folder ? await folderId(f.ownerId, f.folder) : undefined
  const where = and(...conditions(f))
  const order = ordering(f)

  if (f.tab === 'lists') {
    const [rows, [count]] = await Promise.all([
      db.select(FEED_COLS).from(templates).innerJoin(users, eq(templates.ownerId, users.id)).where(where).orderBy(...order).limit(w.limit).offset(w.offset),
      // Счёт БЕЗ join'а на автора: он ничего не отбирает (у списка всегда есть владелец),
      // а индексу мешает.
      db.select({ n: sql<number>`count(*)::int` }).from(templates).where(where),
    ])
    return { items: await withAvatar(rows as FeedItem[]), total: count?.n ?? 0 }
  }

  const starred = and(eq(stars.userId, f.ownerId), where)
  const inFolder = fid ? eq(starFolderItems.folderId, fid) : undefined
  const [rows, [count]] = await Promise.all([
    fid
      ? db
          .select(FEED_COLS)
          .from(stars)
          .innerJoin(templates, eq(stars.templateId, templates.id))
          .innerJoin(users, eq(templates.ownerId, users.id))
          .innerJoin(starFolderItems, and(eq(starFolderItems.templateId, templates.id), inFolder))
          .where(starred)
          .orderBy(...order)
          .limit(w.limit)
          .offset(w.offset)
      : db
          .select(FEED_COLS)
          .from(stars)
          .innerJoin(templates, eq(stars.templateId, templates.id))
          .innerJoin(users, eq(templates.ownerId, users.id))
          .where(starred)
          .orderBy(...order)
          .limit(w.limit)
          .offset(w.offset),
    fid
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(stars)
          .innerJoin(templates, eq(stars.templateId, templates.id))
          .innerJoin(starFolderItems, and(eq(starFolderItems.templateId, templates.id), inFolder))
          .where(starred)
      : db.select({ n: sql<number>`count(*)::int` }).from(stars).innerJoin(templates, eq(stars.templateId, templates.id)).where(starred),
  ])
  return { items: await withAvatar(rows as FeedItem[]), total: count?.n ?? 0 }
}

/**
 * Только id всей текущей выдачи — для пакетных действий («выбрать все»).
 *
 * Отдельно от страницы и намеренно с потолком: разложить по полкам можно всё найденное,
 * а не двадцать показанных строк, но и «всё» обязано иметь предел — иначе одна кнопка
 * снова начинает поднимать корпус.
 *
 * Только для вкладки «Списки»: пакетные действия есть лишь над своей библиотекой, а
 * порядок звёзд опирается на `stars`, которых здесь в запросе нет.
 */
export async function getProfileListIds(f: ProfileListFilter & { tab: 'lists' }, limit: number): Promise<string[]> {
  // Потолок пачки, а не окно страницы, поэтому НЕ через feedWindow: тот падает на
  // непригодном пределе (и правильно — там это тихий полный скан). Здесь предел приходит
  // из квоты (`BULK_MAX` → env), а `envNumber` пропускает и 0, и дробь: уронить владельцу
  // вкладку из-за настройки нельзя, поэтому приводим к разумному целому.
  const max = Math.max(1, Math.floor(limit) || 1)
  const rows = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(...conditions(f)))
    .orderBy(...ordering(f))
    .limit(max)
  return rows.map((r) => r.id)
}

/**
 * Размер очереди разбора: сколько своих списков ещё не лежит ни на одной полке.
 *
 * Отдельным счётом, а не побочным итогом выдачи: он нужен ДО фильтров (по нему решается,
 * показывать ли сам фильтр полок), а выдача к этому моменту уже отфильтрована.
 */
export async function countUnfiledLists(ownerId: string, viewerId?: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(eq(templates.ownerId, ownerId), visibleFilter(viewerId), isNull(templates.repositoryId)))
  return r?.n ?? 0
}
