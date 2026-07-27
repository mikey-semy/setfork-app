import 'server-only'
import { and, arrayOverlaps, eq, inArray, sql } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import { findNearDuplicate, type NearDupCandidate, type NearDupVerdict } from './near-duplicate'

/**
 * Проверка «такой список уже есть» ПЕРЕД записью — по данным БД.
 *
 * Сравниваем не со всей библиотекой, а с близкими по теме: пересечение тегов + свои списки.
 * Так проверка остаётся дешёвой (десятки кандидатов) и при этом ловит именно то, что нужно —
 * клон в той же области. Абсолютно не связанный список дубликатом быть не может.
 *
 * Ограничение осознанное: у кандидата берём ТЕКУЩУЮ версию (то, что читает человек), а не
 * все версии — история дубликатом не считается.
 */
const CANDIDATE_LIMIT = 40

export async function findExistingNearDuplicate(
  fresh: { title: string; items: string[]; tags: string[] },
  opts: { ownerId?: string; excludeId?: string } = {},
): Promise<NearDupVerdict> {
  const tags = fresh.tags.filter((t) => t && t !== '*')
  // Кандидаты: публичные живые списки по пересечению тегов + все свои (свои сравниваем
  // всегда — повторно генерировать себе же одно и то же обиднее всего).
  const rows = await db
    .select({ id: templates.id, title: templates.title, currentVersion: templates.currentVersion })
    .from(templates)
    .where(
      and(
        sql`${templates.archivedAt} is null`,
        opts.excludeId ? sql`${templates.id} <> ${opts.excludeId}` : sql`true`,
        opts.ownerId && tags.length
          ? sql`(${templates.ownerId} = ${opts.ownerId} or (${templates.visibility} = 'public' and ${templates.status} = 'published' and ${arrayOverlaps(templates.tags, tags)}))`
          : opts.ownerId
            ? eq(templates.ownerId, opts.ownerId)
            : and(eq(templates.visibility, 'public'), eq(templates.status, 'published'), tags.length ? arrayOverlaps(templates.tags, tags) : sql`false`),
      ),
    )
    .limit(CANDIDATE_LIMIT)
  if (!rows.length) return { match: null, best: 0 }

  // Заголовки пунктов текущих версий — одним запросом на всех кандидатов.
  const vers = await db
    .select({ id: templateVersions.id, templateId: templateVersions.templateId, version: templateVersions.version })
    .from(templateVersions)
    .where(inArray(templateVersions.templateId, rows.map((r) => r.id)))
  const currentVerId = new Map<string, string>()
  for (const r of rows) {
    const v = vers.find((x) => x.templateId === r.id && x.version === r.currentVersion)
    if (v) currentVerId.set(v.id, r.id)
  }
  const itemRows = currentVerId.size
    ? await db.select({ versionId: steps.versionId, title: steps.title }).from(steps).where(inArray(steps.versionId, [...currentVerId.keys()]))
    : []
  const itemsByTemplate = new Map<string, string[]>()
  for (const it of itemRows) {
    const tplId = currentVerId.get(it.versionId)
    if (!tplId) continue
    const text = Object.values((it.title ?? {}) as Record<string, string>).find(Boolean) ?? ''
    if (text) itemsByTemplate.set(tplId, [...(itemsByTemplate.get(tplId) ?? []), text])
  }

  const candidates: NearDupCandidate[] = rows.map((r) => ({
    id: r.id,
    title: Object.values((r.title ?? {}) as Record<string, string>).find(Boolean) ?? '',
    items: itemsByTemplate.get(r.id) ?? [],
  }))
  return findNearDuplicate(fresh, candidates)
}
