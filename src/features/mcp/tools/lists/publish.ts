import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { PUBLISH_BATCH_MAX, publishOwnedDrafts, type PublishSkip } from '@/features/library/publish-draft'

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

/**
 * Сколько списков публикуем за один вызов.
 *
 * Прежде здесь стояло собственное число «чтобы пачка была обозримой». Теперь предел общий с
 * сайтом и выведен из суточного капа авто-проверки: публиковать больше, чем модерация
 * успевает проверить, — значит копить списки, видимые одному владельцу.
 */
export const MCP_PUBLISH_MAX = PUBLISH_BATCH_MAX

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

/** Причина отказа словами: коды общего слоя → фраза ассистенту. */
const SKIP_REASON: Record<PublishSkip, string> = {
  'not-yours': 'not found among your lists',
  'not-draft': 'already published',
  'over-limit': `over the batch limit of ${PUBLISH_BATCH_MAX}`,
}

/**
 * Опубликовать свои черновики пачкой.
 *
 * Сухой прогон по умолчанию — как у массового создания: план обязан быть виден до того,
 * как в библиотеке что-то изменится.
 *
 * Само правило публикации — в `features/library/publish-draft`, общее с кнопкой на сайте и
 * пакетным действием профиля. Здесь остаётся разбор адресов (`handle/slug` → id) и ответ на
 * языке ассистента.
 */
export async function mcpPublishLists(userId: string, refs: string[], dryRun = true): Promise<McpPublishResult | { error: string }> {
  // Повтор адреса в наборе схлопываем СРАЗУ. Список публикуется один раз в любом случае, но
  // отчёт по повторам насчитал бы «опубликовано 2» на одну запись — ассистент читает эти
  // числа как результат, а не как эхо запроса (находка авто-ревью).
  const list = [...new Set((refs ?? []).map((r) => r.trim()).filter(Boolean))]
  if (!list.length) return { error: 'nothing to publish: pass refs from my_drafts' }
  if (list.length > PUBLISH_BATCH_MAX) return { error: `too many lists in one call: ${list.length} > ${PUBLISH_BATCH_MAX}` }

  const slugs = list.map((ref) => (ref.includes('/') ? ref.split('/').slice(1).join('/') : ref))
  const rows = slugs.length
    ? await db
        .select({ id: templates.id, slug: templates.slug })
        .from(templates)
        .where(and(eq(templates.ownerId, userId), inArray(templates.slug, slugs)))
    : []
  const idBySlug = new Map(rows.map((r) => [r.slug, r.id]))
  // Промах по адресу — не «чужое», а «нет такого»: для общего слоя это один код отказа,
  // и подставлять ему несуществующий id не нужно.
  const ids = slugs.map((s) => idBySlug.get(s)).filter((id): id is string => !!id)
  const report = await publishOwnedDrafts(userId, ids, { dryRun })
  const byId = new Map(report.outcomes.map((o) => [o.id, o]))

  const out: McpPublishResult = { dryRun, planned: list.length, published: 0, skipped: 0, lists: [] }
  list.forEach((ref, i) => {
    const id = idBySlug.get(slugs[i])
    const outcome = id ? byId.get(id) : null
    if (!outcome || outcome.skip) {
      out.skipped++
      out.lists.push({ ref, status: 'skipped', reason: SKIP_REASON[outcome?.skip ?? 'not-yours'] })
      return
    }
    if (dryRun) {
      out.lists.push({ ref, status: 'would-publish' })
      return
    }
    out.published++
    // «Снято модерацией» и «ждёт проверки» — разные вещи: первое админ решает руками, и
    // обещать ассистенту проверку там нельзя.
    const blocked = outcome.moderation === 'flagged' || outcome.moderation === 'hidden'
    const reason = blocked ? 'blocked by moderation — only an admin can lift it' : outcome.moderation === 'pending' ? 'sent to moderation' : undefined
    out.lists.push({ ref, status: 'published', reason })
  })
  return out
}
