'use server'

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, repositories, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
// eslint-disable-next-line boundaries/dependencies -- полки принадлежат каталогам; мост держим ОДНОЙ точкой, а не копией `ensure` здесь (тот же приём, что gitPort в actions/shared)
import { catalogStore } from '@/features/catalogs/adapter'
import { publishOwnedDrafts } from '../publish-draft'
import { slugify } from '../slug'
import { BULK_MAX } from './limits'

/**
 * ПАКЕТНЫЕ ДЕЙСТВИЯ НАД СВОИМИ СПИСКАМИ: разложить по полкам, опубликовать отобранное.
 *
 * Повод измерен, а не выдуман: у владельца 523 списка и 520 из них не разложены. По одному
 * это не работа, а причина её не делать, — и полка, заведённая полгода назад, стоит пустой
 * ровно поэтому.
 *
 * Правила, каждое против конкретной беды:
 *
 *  - ЧУЖОЕ НЕ ТРОГАЕМ. Набор идентификаторов приходит из браузера, поэтому владение
 *    проверяется запросом (`ownerId`), а не доверием к присланному.
 *  - ВОЗВРАТ ВМЕСТО ПОДТВЕРЖДЕНИЯ там, где действие обратимо. Перекладывание по полкам
 *    выполняется сразу и возвращает КАРТУ прежних полок: отмена ставит каждый список туда,
 *    где он лежал, а не сваливает всё в одну. Диалог «вы уверены?» стоит внимания каждый
 *    раз, отмена — только когда ошиблись (форма из почтовых клиентов и файловых менеджеров).
 *  - ПУБЛИКАЦИЯ — НАОБОРОТ. Она выносит написанное наружу, поэтому спрашивает заранее:
 *    сперва план (`dryRun`), потом запись. Отменять уже показанное поздно.
 */

/** Куда вернуть списки при отмене: полка (или её отсутствие) → идентификаторы. */
export interface RestoreGroup {
  catalogId: string | null
  ids: string[]
}

export interface MoveResult {
  changed: number
  /** Прежнее размещение — данные для «Отменить». */
  restore: RestoreGroup[]
  /** Куда переложили. Отмена вернёт только то, что ДО СИХ ПОР лежит здесь. */
  movedTo?: string | null
  /** Почему не вышло: полка исчезла или из имени не получилось технического. */
  error?: 'catalog-not-found' | 'bad-name'
}

/**
 * Условие «этот список пачке трогать можно»: он твой и он правим.
 *
 * Живёт ОДНИМ выражением и подставляется и в отбор, и в каждую запись. Проверка «сначала
 * посмотрели, потом пишем» защищает ровно до первой гонки: пока пачка идёт по списку,
 * получатель успевает принять передачу прав, и прежний владелец допишет уже чужой список
 * (находка авто-ревью). Условие в самом запросе такого окна не оставляет.
 *
 * Архив и заморозка здесь же: полка — свойство списка, а у архивного свойства не меняются
 * вовсе (`canEditList`), и пачка не может быть лазейкой мимо запрета, который держит
 * одиночная правка.
 */
function editable(userId: string, ids: string[]) {
  return and(eq(templates.ownerId, userId), inArray(templates.id, ids), isNull(templates.archivedAt), isNull(templates.frozenAt))
}

/** Списки из присланного набора, которые пачке позволено трогать. */
async function ownIds(userId: string, ids: string[]): Promise<string[]> {
  const clean = [...new Set(ids.filter(Boolean))].slice(0, BULK_MAX)
  if (!clean.length) return []
  const rows = await db.select({ id: templates.id }).from(templates).where(editable(userId, clean))
  return rows.map((r) => r.id)
}

/** Полка владельца по имени; null — «снять с полки», undefined — имени нет. */
async function ownCatalogId(userId: string, name: string | null): Promise<string | null | undefined> {
  if (!name) return null
  const [cat] = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.ownerId, userId), eq(repositories.name, name)))
    .limit(1)
  return cat?.id
}

/** Разложить списки по полке (`catalogName: null` — снять с полки). */
export async function bulkSetCatalog(ids: string[], catalogName: string | null): Promise<MoveResult> {
  const session = await requireSession()
  const [mine, targetId] = await Promise.all([ownIds(session.userId, ids), ownCatalogId(session.userId, catalogName)])
  if (targetId === undefined) return { changed: 0, restore: [], error: 'catalog-not-found' }
  if (!mine.length) return { changed: 0, restore: [] }

  // Снимок и запись — одной транзакцией: карта возврата обязана описывать ровно то, что мы
  // затёрли. Между отдельными «прочитать» и «записать» полка списка успевает измениться из
  // соседней вкладки, и «Отменить» вернуло бы его не туда, где он был.
  //
  // `updatedAt` НЕ трогаем — как и одиночный перенос через `catalogStore`. Полка это не
  // правка содержимого; иначе разложил пятьсот списков — и все пятьсот всплыли в лентах «по
  // обновлению» с сегодняшней датой, хотя ни одна буква в них не изменилась.
  const before = await db.transaction(async (tx) => {
    // Полку перепроверяем ПОД ЗАМКОМ. Между `ownCatalogId` и этой записью её успевают
    // удалить, а внешнего ключа у `repositoryId` нет — списки молча уехали бы на
    // несуществующую полку и пропали разом из всех фильтров (находка авто-ревью).
    if (targetId) {
      const [live] = await tx.select({ id: repositories.id }).from(repositories).where(and(eq(repositories.id, targetId), eq(repositories.ownerId, session.userId))).for('update')
      if (!live) return null
    }
    // Условие повторяется и под замком: между отбором и транзакцией список успевает сменить
    // владельца, и без него мы заперли бы уже чужую строку и положили её на свою полку.
    const rows = await tx.select({ id: templates.id, repositoryId: templates.repositoryId }).from(templates).where(editable(session.userId, mine)).for('update')
    if (!rows.length) return rows
    await tx.update(templates).set({ repositoryId: targetId }).where(editable(session.userId, rows.map((r) => r.id)))
    return rows
  })
  if (before === null) return { changed: 0, restore: [], error: 'catalog-not-found' }
  revalidatePath(`/${session.handle}`)

  const groups = new Map<string | null, string[]>()
  for (const row of before) groups.set(row.repositoryId, [...(groups.get(row.repositoryId) ?? []), row.id])
  // Считаем по тому, что реально заперли и записали, а не по намерению.
  return { changed: before.length, restore: [...groups].map(([catalogId, ids]) => ({ catalogId, ids })), movedTo: targetId }
}

/**
 * Завести полку и сразу сложить на неё отобранное.
 *
 * Без этого пакетная раскладка упирается в порядок действий: полка создаётся только в
 * настройках отдельного списка, то есть чтобы разложить пятьсот, надо открыть один, завести
 * там полку, вернуться. Имя приводится к техническому виду тем же `slugify`, что и всюду, а
 * набранное человеком остаётся заголовком.
 */
export async function bulkCreateCatalogAndMove(ids: string[], rawTitle: string): Promise<MoveResult> {
  const session = await requireSession()
  const title = rawTitle.trim()
  const name = slugify(title)
  // Имя из одних знаков препинания или иероглифов даёт пустой технический slug. Это не
  // «полка не найдена», а «такое имя не годится» — и сказать надо именно это.
  if (!name) return { changed: 0, restore: [], error: 'bad-name' }
  const lang = await getLang()
  const catalogId = await catalogStore.ensure(session.userId, name, { [lang]: title })
  if (!catalogId) return { changed: 0, restore: [], error: 'catalog-not-found' }
  return bulkSetCatalog(ids, name)
}

/**
 * Отмена перекладывания: каждый список — обратно на свою прежнюю полку.
 *
 * `movedTo` — полка, куда пачка их положила. Возвращаем ТОЛЬКО то, что до сих пор там и
 * лежит: пока тост с «Отменить» висит, список успевают переложить руками из другой вкладки,
 * и слепая отмена затёрла бы этот свежий, осознанный выбор снимком до пачки (находка
 * авто-ревью).
 */
export async function bulkRestoreCatalog(move: Pick<MoveResult, 'restore' | 'movedTo'>): Promise<{ changed: number }> {
  const session = await requireSession()
  // Принимаем результат перекладывания ЦЕЛИКОМ, а не список групп: пункт назначения тут не
  // дополнение, а часть смысла отмены, и вторым необязательным доводом его легко забыть.
  const { restore: groups, movedTo = null } = move
  const mine = new Set(await ownIds(session.userId, groups.flatMap((g) => g.ids)))
  let changed = 0
  // Полок в возврате столько, сколько их было у пачки, — единицы. Раскладывать эти
  // несколько запросов параллельно нечего: выигрыш микроскопический, а порядок записи
  // перестаёт быть предсказуемым.
  for (const group of groups) {
    const ids = group.ids.filter((id) => mine.has(id))
    if (!ids.length) continue
    // Полку проверяем по владельцу и здесь: карта возврата пришла из браузера, а значит
    // могла бы указать на чужую полку не хуже, чем прямой вызов.
    const catalogId = group.catalogId
      ? (
          await db
            .select({ id: repositories.id })
            .from(repositories)
            .where(and(eq(repositories.ownerId, session.userId), eq(repositories.id, group.catalogId)))
            .limit(1)
        )[0]?.id ?? null
      : null
    const stillThere = movedTo ? eq(templates.repositoryId, movedTo) : isNull(templates.repositoryId)
    const back = await db
      .update(templates)
      .set({ repositoryId: catalogId })
      .where(and(editable(session.userId, ids), stillThere))
      .returning({ id: templates.id })
    changed += back.length
  }
  revalidatePath(`/${session.handle}`)
  return { changed }
}

export interface PublishBatchResult {
  /** Ушли в паблик сразу. */
  published: number
  /** Опубликованы, но ждут авто-проверку: видны пока только владельцу. */
  pending: number
  /** Опубликованы, но сняты модерацией: проверки не будет, решает админ. */
  blocked: number
  /** Не тронуты: чужое или уже опубликованное. */
  skipped: number
  /** Сколько из отобранного не поместилось в пачку (см. PUBLISH_BATCH_MAX). */
  overflow: number
  /** true — это ПЛАН, в библиотеке ещё ничего не изменилось. */
  dryRun: boolean
}

/**
 * Опубликовать отобранные черновики.
 *
 * `dryRun` по умолчанию: интерфейс сначала показывает, что именно произойдёт (сколько уйдёт
 * в паблик, сколько на проверку, что пропущено), и только по согласию зовёт с `false`.
 * Правило публикации общее с кнопкой на странице списка и с MCP.
 */
export async function bulkPublish(ids: string[], dryRun = true): Promise<PublishBatchResult> {
  const session = await requireSession()
  const report = await publishOwnedDrafts(session.userId, ids.slice(0, BULK_MAX), { dryRun })
  if (!dryRun) revalidatePath(`/${session.handle}`)
  return { published: report.published, pending: report.pending, blocked: report.blocked, skipped: report.skipped, overflow: report.overflow, dryRun }
}
