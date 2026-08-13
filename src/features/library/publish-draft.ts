import 'server-only'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { publicationDecision } from '@/shared/moderation/publication-state'
// eslint-disable-next-line boundaries/dependencies -- барьер модерации неотделим от публикации; мост держим ЗДЕСЬ одной точкой (как gitPort в actions/shared), а не по копии в каждом входе
import { MODERATE_DAILY_CAP, gateListPublication } from '@/features/moderation/moderate-list'

/**
 * ПУБЛИКАЦИЯ ЧЕРНОВИКА — одно правило на все входы.
 *
 * Черновик становится опубликованным ровно тремя действиями: проверить, что список твой и
 * ещё черновик, перевести статус, провести публичный через модерационный барьер. Это уже
 * было написано трижды — кнопкой на странице списка, инструментом MCP и пакетным действием
 * профиля, — а расходится такая тройка всегда в одну сторону: где-то забывают барьер.
 * Поэтому правило живёт здесь, а входы только зовут.
 *
 * Причины отказа возвращаются КОДАМИ, а не фразами: MCP отвечает по-английски ассистенту,
 * интерфейс — словарём на языке зрителя, и общий слой не должен выбирать за них.
 */

/**
 * Сколько черновиков публикуем за один вызов.
 *
 * Число не выбрано «на глаз»: авто-проверка расходует модель и ограничена сутками на автора
 * (`MODERATE_DAILY_CAP`). Всё, что сверх этого, барьер поставить в очередь уже не сможет —
 * такие списки останутся видимыми только владельцу с пометкой «ждёт ручной проверки». Пачка
 * больше суточного предела не публикует, а копит непроверенное.
 */
export const PUBLISH_BATCH_MAX = MODERATE_DAILY_CAP

/** Снят модерацией: его судьбу решает только админ, публикация тут ничего не меняет. */
const isBlocked = (row: { moderation: string }) => row.moderation === 'flagged' || row.moderation === 'hidden'

/** Список, который публикация выставляет наружу и потому ведёт через барьер. */
const needsGate = (row: { moderation: string; visibility: string }) => row.visibility === 'public' && !isBlocked(row)

/** Почему список не опубликован. Коды: текст добавляет вызывающий на своём языке. */
export type PublishSkip = 'not-yours' | 'not-draft' | 'over-limit' | 'read-only' | 'changed-meanwhile'

export interface PublishOutcome {
  id: string
  /** null — опубликован (или был бы опубликован при dryRun); иначе причина отказа. */
  skip: PublishSkip | null
  /** Состояние модерации после публикации: 'pending' = виден пока только владельцу. */
  moderation: string | null
}

export interface PublishReport {
  outcomes: PublishOutcome[]
  /** Сколько ушло в паблик прямо сейчас. */
  published: number
  /** Сколько ждёт проверки — их пока не видит никто, кроме владельца. */
  pending: number
  /**
   * Сколько снято модерацией. Отдельно от `pending` нарочно: снятый список не ждёт
   * проверку — он заблокирован, пока не решит админ, и сказать про него «на проверке»
   * значит обещать то, чего не будет (находка авто-ревью).
   */
  blocked: number
  /** Сколько пропущено (чужое, уже опубликовано). */
  skipped: number
  /** Сколько черновиков не поместилось в пачку и осталось черновиками. */
  overflow: number
}

/**
 * Опубликовать свои черновики по идентификаторам.
 *
 * `dryRun` — план без записи: в интерфейсе он показывает человеку, что именно произойдёт,
 * в MCP это поведение по умолчанию.
 */
export async function publishOwnedDrafts(userId: string, ids: string[], opts: { dryRun?: boolean } = {}): Promise<PublishReport> {
  const wanted = [...new Set(ids.filter(Boolean))]
  const report: PublishReport = { outcomes: [], published: 0, pending: 0, blocked: 0, skipped: 0, overflow: 0 }
  if (!wanted.length) return report

  const rows = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      status: templates.status,
      visibility: templates.visibility,
      moderation: templates.moderation,
      archivedAt: templates.archivedAt,
      frozenAt: templates.frozenAt,
    })
    .from(templates)
    .where(inArray(templates.id, wanted))
  const byId = new Map(rows.map((r) => [r.id, r]))

  const drafts: typeof rows = []
  for (const id of wanted) {
    const row = byId.get(id)
    if (!row || row.ownerId !== userId) {
      report.outcomes.push({ id, skip: 'not-yours', moderation: null })
      continue
    }
    if (row.status !== 'draft') {
      report.outcomes.push({ id, skip: 'not-draft', moderation: null })
      continue
    }
    // Архив и заморозка запрещают правку списка (`canEditList`), а публикация — правка
    // самая крупная. Проверка стоит ЗДЕСЬ, в общем слое: у пакетного действия она была, а
    // MCP и кнопка адресуют список напрямую и обошли бы её (находка авто-ревью).
    if (row.archivedAt || row.frozenAt) {
      report.outcomes.push({ id, skip: 'read-only', moderation: null })
      continue
    }
    drafts.push(row)
  }
  report.skipped = report.outcomes.length
  // Предел режем ПО ЧЕРНОВИКАМ, а не по присланному набору: иначе двадцать уже
  // опубликованных списков в отборе съедали бы всю пачку, и публиковать становилось нечего.
  const go = drafts.slice(0, PUBLISH_BATCH_MAX)
  report.overflow = drafts.length - go.length
  for (const row of drafts.slice(PUBLISH_BATCH_MAX)) report.outcomes.push({ id: row.id, skip: 'over-limit', moderation: null })
  if (!go.length || opts.dryRun) {
    // ПЛАН СЧИТАЕТСЯ ТЕМ ЖЕ ПРАВИЛОМ, что и запись, только без записи. Иначе диалог обещает
    // «опубликовать 20», а результат приходит «на проверке: 20» — и хуже того, набор из
    // одних снятых модерацией предлагается к публикации как ни в чём не бывало (находка
    // авто-ревью). Решение об авторе одно на пачку: оно и не зависит от списка.
    const decision = go.some((r) => needsGate(r)) ? await publicationDecision(userId, null) : null
    for (const row of go) {
      const moderation = isBlocked(row) ? row.moderation : needsGate(row) && decision === 'hold' ? 'pending' : 'active'
      report.outcomes.push({ id: row.id, skip: null, moderation })
      if (isBlocked(row)) report.blocked++
      else if (moderation === 'pending') report.pending++
      else report.published++
    }
    return report
  }

  // Что реально записалось: гонка с админом отсеивает строки, и отчёт обязан считать по
  // ним, а не по намерению.
  const landed: typeof go = []
  for (const row of go) {
    // ПУБЛИКУЕМ ПО ОДНОМУ И СРАЗУ С УДЕРЖАНИЕМ.
    //
    // Пока это была общая запись «все → published» и барьер следом, публичные списки
    // недоверенного автора успевали побыть видимыми всем, а прерванный запрос оставлял
    // непроверенный остаток открытым насовсем (находка авто-ревью, P1).
    //
    // Поэтому публичный список рождается опубликованным СРАЗУ в `pending` — то есть
    // видимым только владельцу, — а барьер следом решает, отпустить удержание (автору
    // доверяем / проверки в этой сборке нет) или оставить и поставить проверку в очередь.
    // Так же устроен путь СОЗДАНИЯ: состояние решается до появления видимой строки, а не
    // догоняет её отдельным шагом (shared/moderation/publication-state).
    //
    // Приватный не трогаем: наружу он не выставлен, проверять в нём нечего. Снятое
    // модерацией — тем более: его судьбу решает только админ.
    // Запись УСЛОВНАЯ — по состоянию, которое мы видели. Между чтением пачки и этой
    // строкой админ успевает снять список, и безусловное «moderation = pending» затёрло бы
    // его решение, а барьер следом отпустил бы удержание доверенному автору — снятое стало
    // бы публичным (находка авто-ревью, P1). Условие в самом UPDATE, а не проверкой перед
    // ним: проверка — это ещё одно окно между «посмотрел» и «записал».
    const hold = needsGate(row)
    const [wrote] = await db
      .update(templates)
      .set(hold ? { status: 'published', moderation: 'pending', updatedAt: new Date() } : { status: 'published', updatedAt: new Date() })
      .where(
        and(
          eq(templates.id, row.id),
          eq(templates.status, 'draft'),
          // Видимость — в условие наравне со статусом. Пока пачка идёт по списку, соседняя
          // вкладка успевает открыть приватный список: прочитан он был приватным, значит
          // барьер для него пропустят, и публичным он стал бы БЕЗ проверки и навсегда
          // (находка авто-ревью, P1). Раз состояние изменилось — не публикуем вовсе.
          eq(templates.visibility, row.visibility),
          hold ? notInArray(templates.moderation, ['flagged', 'hidden']) : sql`true`,
        ),
      )
      .returning({ id: templates.id })
    if (!wrote) {
      report.outcomes.push({ id: row.id, skip: 'changed-meanwhile', moderation: null })
      report.skipped++
      continue
    }
    if (row.visibility === 'public') await gateListPublication(row.id)
    landed.push(row)
  }

  // Итог читаем ИЗ БАЗЫ, а не предполагаем: решение принял барьер, и только он знает,
  // отпущено удержание или список ждёт проверки. Одним запросом на всю пачку.
  if (!landed.length) return report
  const after = await db
    .select({ id: templates.id, moderation: templates.moderation })
    .from(templates)
    .where(inArray(templates.id, landed.map((r) => r.id)))
  const modOf = new Map(after.map((r) => [r.id, r.moderation]))
  for (const row of landed) {
    const moderation = modOf.get(row.id) ?? null
    report.outcomes.push({ id: row.id, skip: null, moderation })
    // Считаем по видимости: у приватного отметка модерации может остаться с прошлой
    // публичной жизни, и «на проверке» про список, которого никто не видит, — чепуха.
    if (row.visibility !== 'public') report.published++
    else if (moderation === 'flagged' || moderation === 'hidden') report.blocked++
    else if (moderation === 'pending') report.pending++
    else report.published++
  }
  return report
}

/** Опубликовать один свой черновик. Тот же барьер — просто пачка из одного. */
export async function publishOwnedDraft(userId: string, templateId: string): Promise<PublishOutcome> {
  const { outcomes } = await publishOwnedDrafts(userId, [templateId])
  return outcomes[0] ?? { id: templateId, skip: 'not-yours', moderation: null }
}
