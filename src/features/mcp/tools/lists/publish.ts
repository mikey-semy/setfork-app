import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import { gateListPublication } from '@/features/moderation/moderate-list'
import { tr } from '@/shared/i18n'

/**
 * РАЗБОР ЧЕРНОВИКОВ ЧЕРЕЗ MCP.
 *
 * Зачем: сотня-другая неопубликованных списков разбирается по одному через интерфейс
 * часами, и это ровно тот случай, когда объём пугает больше, чем работа. Через ассистента
 * то же делается пачкой: посмотреть, что лежит, и опубликовать отобранное.
 *
 * МОДЕРАЦИЮ ЭТО НЕ ОБХОДИТ. Публикация зовёт тот же `gateListPublication`, что и кнопка
 * на сайте: снятое модерацией не «отмывается» повторной публикацией, остальное уходит в
 * `pending` и на авто-проверку. Барьер живёт в сервисном слое, а не в интерфейсе, — иначе
 * любой второй путь публикации его бы и обошёл.
 */

/** Сколько списков публикуем за один вызов: пачка должна оставаться обозримой человеку. */
export const MCP_PUBLISH_MAX = 25

export interface DraftRow {
  ref: string
  title: string
  tags: string[]
  /** Сколько блоков в текущей версии — по нему видно, пустышка это или готовый список. */
  blocks: number
  createdAt: string
}

/** Свои неопубликованные списки: то, что ждёт решения. */
export async function mcpMyDrafts(userId: string, opts: { tag?: string; limit?: number } = {}): Promise<{ count: number; total: number; drafts: DraftRow[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  const tag = opts.tag?.trim().toLowerCase()
  const where = and(
    eq(templates.ownerId, userId),
    eq(templates.status, 'draft'),
    sql`${templates.archivedAt} is null`,
    tag ? sql`${tag} = any(${templates.tags})` : sql`true`,
  )
  const [[total], rows, [owner]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(templates).where(where),
    db
      .select({ id: templates.id, slug: templates.slug, title: templates.title, tags: templates.tags, currentVersion: templates.currentVersion, createdAt: templates.createdAt })
      .from(templates)
      .where(where)
      .orderBy(desc(templates.createdAt))
      .limit(limit),
    db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1),
  ])
  // Число блоков — одним запросом на всю выборку: по запросу на список это N обращений
  // к базе ради одной цифры.
  const versions = rows.length
    ? await db
        .select({ id: templateVersions.id, templateId: templateVersions.templateId, version: templateVersions.version })
        .from(templateVersions)
        .where(inArray(templateVersions.templateId, rows.map((r) => r.id)))
    : []
  const verOf = new Map(rows.map((r) => [r.id, versions.find((v) => v.templateId === r.id && v.version === r.currentVersion)?.id]))
  const counts = new Map<string, number>()
  const verIds = [...verOf.values()].filter((v): v is string => !!v)
  if (verIds.length) {
    const grouped = await db
      .select({ versionId: steps.versionId, n: sql<number>`count(*)::int` })
      .from(steps)
      .where(inArray(steps.versionId, verIds))
      .groupBy(steps.versionId)
    for (const g of grouped) counts.set(g.versionId, g.n)
  }
  return {
    total: total?.n ?? 0,
    count: rows.length,
    drafts: rows.map((r) => ({
      ref: `${owner?.handle ?? ''}/${r.slug}`,
      title: tr(r.title as Record<string, string>, 'en'),
      tags: r.tags ?? [],
      blocks: counts.get(verOf.get(r.id) ?? '') ?? 0,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    })),
  }
}

export interface PublishOutcome {
  ref: string
  status: 'published' | 'would-publish' | 'skipped'
  reason?: string
}

export interface McpPublishResult {
  dryRun: boolean
  planned: number
  published: number
  skipped: number
  lists: PublishOutcome[]
}

/**
 * Опубликовать свои черновики пачкой.
 *
 * Сухой прогон по умолчанию — как у массового создания: план обязан быть виден до того,
 * как в библиотеке что-то изменится.
 */
export async function mcpPublishLists(userId: string, refs: string[], dryRun = true): Promise<McpPublishResult | { error: string }> {
  const list = (refs ?? []).map((r) => r.trim()).filter(Boolean)
  if (!list.length) return { error: 'nothing to publish: pass refs from my_drafts' }
  if (list.length > MCP_PUBLISH_MAX) return { error: `too many lists in one call: ${list.length} > ${MCP_PUBLISH_MAX}` }

  const out: McpPublishResult = { dryRun, planned: list.length, published: 0, skipped: 0, lists: [] }
  for (const ref of list) {
    const slug = ref.includes('/') ? ref.split('/').slice(1).join('/') : ref
    const [tpl] = await db
      .select({ id: templates.id, status: templates.status, visibility: templates.visibility, moderation: templates.moderation })
      .from(templates)
      .where(and(eq(templates.ownerId, userId), eq(templates.slug, slug)))
      .limit(1)
    if (!tpl) {
      out.skipped++
      out.lists.push({ ref, status: 'skipped', reason: 'not found among your lists' })
      continue
    }
    if (tpl.status !== 'draft') {
      out.skipped++
      out.lists.push({ ref, status: 'skipped', reason: `already ${tpl.status}` })
      continue
    }
    if (dryRun) {
      out.lists.push({ ref, status: 'would-publish' })
      continue
    }
    await db.update(templates).set({ status: 'published', updatedAt: new Date() }).where(eq(templates.id, tpl.id))
    // Тот же барьер, что и у кнопки на сайте: публичный список идёт через модерацию.
    if (tpl.visibility === 'public') await gateListPublication(tpl.id)
    out.published++
    out.lists.push({ ref, status: 'published', reason: tpl.visibility === 'public' ? 'sent to moderation' : undefined })
  }
  return out
}
