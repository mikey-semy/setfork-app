import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { PUBLISH_BATCH_MAX, publishOwnedDrafts, type PublishSkip } from '@/features/library/publish-draft'
import { resolveListRefOrMoved } from '../shared'

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
    // Архив И заморозка: публикация такой список не возьмёт (он read-only), а перечень без
    // этого условия предлагал бы ассистенту адрес, по которому ничего сделать нельзя —
    // работа по кругу вместо отказа сразу (находка авто-ревью).
    sql`${templates.archivedAt} is null`,
    sql`${templates.frozenAt} is null`,
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

/** Что станет со списком по плану — по состоянию модерации, которое обещает общий слой. */
const PLAN_NOTE: Record<string, string | undefined> = {
  flagged: 'blocked by moderation — publishing changes nothing',
  hidden: 'blocked by moderation — publishing changes nothing',
  pending: 'will go to moderation before anyone else sees it',
}

/** Причина отказа словами: коды общего слоя → фраза ассистенту. */
const SKIP_REASON: Record<PublishSkip, string> = {
  'not-yours': 'not found among your lists',
  'not-draft': 'already published',
  'over-limit': `over the batch limit of ${PUBLISH_BATCH_MAX}`,
  'read-only': 'archived or frozen — read-only',
  'changed-meanwhile': 'changed while publishing — read it again',
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

  // АДРЕС РАЗБИРАЕТСЯ ЦЕЛИКОМ, вместе с владельцем. Раньше префикс отбрасывался — «владельца
  // определяет токен, не префикс», — и `чужой/deploy` публиковал СВОЙ `deploy`, отчитываясь
  // при этом чужим адресом. Ассистент просил одно, получал другое и читал ответ как успех
  // (находка авто-ревью на #789). Полный адрес резолвится общим резолвером, поэтому и
  // ПРЕЖНИЕ адреса своих списков продолжают работать; чужое отсеет общий слой кодом
  // `not-yours` — здесь для этого ничего решать не надо.
  const idOfRef = new Map<string, string>()
  await Promise.all(
    list.map(async (ref) => {
      if (ref.includes('/')) {
        const found = await resolveListRefOrMoved(ref)
        if (found) idOfRef.set(ref, found.id)
        return
      }
      const [row] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.ownerId, userId), eq(templates.slug, ref)))
        .limit(1)
      if (row) idOfRef.set(ref, row.id)
    }),
  )

  // Дедуп — по РАЗРЕШЁННОМУ id, а не по строке и не по слагу: `owner/foo`, `foo` и прежний
  // адрес того же списка — одна запись. Иначе отчёт насчитает «опубликовано 2» на один
  // список, а ассистент читает эти числа как результат, а не как эхо запроса.
  const firstRefOf = new Map<string, string>()
  for (const ref of list) {
    const id = idOfRef.get(ref)
    if (id && !firstRefOf.has(id)) firstRefOf.set(id, ref)
  }
  const ids = [...firstRefOf.keys()]
  const report = await publishOwnedDrafts(userId, ids, { dryRun })
  const byId = new Map(report.outcomes.map((o) => [o.id, o]))

  const out: McpPublishResult = { dryRun, planned: list.length, published: 0, skipped: 0, lists: [] }
  list.forEach((ref) => {
    const id = idOfRef.get(ref)
    const outcome = id ? byId.get(id) : null
    // ОТКАЗ ПРОВЕРЯЕМ ПЕРВЫМ, и только потом повтор. Иначе два ЧУЖИХ адреса одного списка
    // получали ответ «тот же список, что X» — то есть инструмент подтверждал постороннему,
    // что два адреса ведут в одну запись, хотя про чужое он обязан отвечать одинаково:
    // «нет такого среди твоих». Находка линзы 02 на этом же PR.
    if (!outcome || outcome.skip) {
      out.skipped++
      out.lists.push({ ref, status: 'skipped', reason: SKIP_REASON[outcome?.skip ?? 'not-yours'] })
      return
    }
    if (id && firstRefOf.get(id) !== ref) {
      out.skipped++
      out.lists.push({ ref, status: 'skipped', reason: `same list as ${firstRefOf.get(id)}` })
      return
    }
    if (dryRun) {
      // План обязан обещать то же, что и запись: снятое модерацией так и останется скрытым,
      // а публичное недоверенного автора уйдёт на проверку. Молчаливое «would-publish» на
      // снятом списке — обещание, которое исполнение не выполнит (находка авто-ревью).
      out.lists.push({ ref, status: 'would-publish', reason: PLAN_NOTE[outcome.moderation ?? ''] })
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
