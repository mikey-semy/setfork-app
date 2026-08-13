import 'server-only'
import { inArray } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
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

/** Почему список не опубликован. Коды: текст добавляет вызывающий на своём языке. */
export type PublishSkip = 'not-yours' | 'not-draft' | 'over-limit'

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
  const report: PublishReport = { outcomes: [], published: 0, pending: 0, skipped: 0, overflow: 0 }
  if (!wanted.length) return report

  const rows = await db
    .select({ id: templates.id, ownerId: templates.ownerId, status: templates.status, visibility: templates.visibility })
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
    drafts.push(row)
  }
  report.skipped = report.outcomes.length
  // Предел режем ПО ЧЕРНОВИКАМ, а не по присланному набору: иначе двадцать уже
  // опубликованных списков в отборе съедали бы всю пачку, и публиковать становилось нечего.
  const go = drafts.slice(0, PUBLISH_BATCH_MAX)
  report.overflow = drafts.length - go.length
  for (const row of drafts.slice(PUBLISH_BATCH_MAX)) report.outcomes.push({ id: row.id, skip: 'over-limit', moderation: null })
  if (!go.length || opts.dryRun) {
    for (const row of go) report.outcomes.push({ id: row.id, skip: null, moderation: null })
    report.published = go.length
    return report
  }

  await db
    .update(templates)
    .set({ status: 'published', updatedAt: new Date() })
    .where(inArray(templates.id, go.map((r) => r.id)))
  // Барьер — по одному: он решает судьбу каждого списка отдельно (доверенный автор, снятое
  // модерацией, исчерпанный суточный кап) и заведомо не сводится к одному запросу.
  for (const row of go) if (row.visibility === 'public') await gateListPublication(row.id)

  // Состояние читаем ПОСЛЕ барьера, а не предполагаем: списку могло достаться pending —
  // тогда он опубликован, но виден пока только владельцу, и человек обязан это узнать.
  const after = await db
    .select({ id: templates.id, moderation: templates.moderation })
    .from(templates)
    .where(inArray(templates.id, go.map((r) => r.id)))
  const modOf = new Map(after.map((r) => [r.id, r.moderation]))
  for (const row of go) {
    const moderation = modOf.get(row.id) ?? null
    report.outcomes.push({ id: row.id, skip: null, moderation })
    if (moderation === 'active') report.published++
    else report.pending++
  }
  return report
}

/** Опубликовать один свой черновик. Тот же барьер — просто пачка из одного. */
export async function publishOwnedDraft(userId: string, templateId: string): Promise<PublishOutcome> {
  const { outcomes } = await publishOwnedDrafts(userId, [templateId])
  return outcomes[0] ?? { id: templateId, skip: 'not-yours', moderation: null }
}
