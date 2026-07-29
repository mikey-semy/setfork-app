import 'server-only'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, linkChecks, linkOccurrences, steps, templateVersions, templates, publiclyVisible } from '@/shared/db'
import { extractUrls, normalizeUrl, productItems, urlHost, walkStrings } from '@/core'
import { log } from '@/shared/observability'

// Харвест URL по всем поверхностям контента публичных активных списков:
// refs шагов, product/video/file-блоки и ИНЛАЙН-ссылки markdown (desc/why/
// subtasks/text-блоки) — без walkStrings инлайн уходил бы мимо проверки
// (та же слепая зона была у модерации до contentStrings).

interface Occ {
  stepId: string | null
  urlNorm: string
  source: 'ref' | 'product' | 'video' | 'file' | 'inline'
  refIndex: number
}

/** Вхождения URL одного списка (текущая версия). Чисто собираем — писать будет harvestTemplate. */
function collectOccurrences(rows: (typeof steps.$inferSelect)[], tplDesc: unknown): Occ[] {
  const out: Occ[] = []
  const push = (stepId: string | null, raw: string | undefined, source: Occ['source'], refIndex = 0) => {
    const norm = raw ? normalizeUrl(raw) : null
    if (norm) out.push({ stepId, urlNorm: norm, source, refIndex })
  }
  for (const s of rows) {
    ;(s.refs ?? []).forEach((r, i) => push(s.id, r.url, 'ref', i))
    const c = (s.content ?? {}) as Record<string, unknown>
    if (s.type === 'product') productItems(s.content).forEach((p) => push(s.id, p.url, 'product', p.idx))
    else if (s.type === 'video') push(s.id, typeof c.url === 'string' ? c.url : undefined, 'video')
    else if (s.type === 'file') push(s.id, typeof c.url === 'string' ? c.url : undefined, 'file')
    // Инлайн-ссылки в любом тексте шага/блока (markdown, desc, why, subtasks).
    const texts = walkStrings([s.desc, s.why, s.subtasks, s.type === 'text' ? c : null])
    for (const t of texts) for (const u of extractUrls(t)) push(s.id, u, 'inline')
  }
  for (const t of walkStrings(tplDesc)) for (const u of extractUrls(t)) push(null, u, 'inline')
  // Дедуп в рамках списка: (stepId, urlNorm, source, refIndex)
  const seen = new Set<string>()
  return out.filter((o) => {
    const k = `${o.stepId}|${o.urlNorm}|${o.source}|${o.refIndex}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Пересобрать вхождения одного списка + завести неизвестные URL в link_checks. */
export async function harvestTemplate(templateId: string): Promise<number> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return 0
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, tpl.currentVersion)))
  const rows = ver ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n)) : []
  const occs = collectOccurrences(rows, tpl.desc)

  await db.transaction(async (tx) => {
    await tx.delete(linkOccurrences).where(eq(linkOccurrences.templateId, templateId))
    if (occs.length) {
      await tx.insert(linkOccurrences).values(occs.map((o) => ({ templateId, ...o })))
      const uniq = [...new Set(occs.map((o) => o.urlNorm))]
      await tx
        .insert(linkChecks)
        .values(uniq.map((u) => ({ urlNorm: u, host: urlHost(u) })))
        .onConflictDoNothing({ target: linkChecks.urlNorm })
    }
  })
  return occs.length
}

/** Харвест корпуса: публичные+активные списки, порциями. Возвращает число списков. */
export async function harvestAll(limit = 500): Promise<number> {
  const tpls = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(publiclyVisible()))
    .orderBy(sql`${templates.updatedAt} desc`)
    .limit(limit)
  for (const t of tpls) await harvestTemplate(t.id)
  log.info('linkcheck: harvest done', { templates: tpls.length })
  return tpls.length
}
