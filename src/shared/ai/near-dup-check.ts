import 'server-only'
import { and, arrayOverlaps, desc, eq, inArray, sql } from 'drizzle-orm'
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
// Публичных по тегам может быть сколько угодно — их берём пачкой. СВОИ списки берём
// ВСЕ: обещание «свои сравниваем всегда» иначе не выполняется, а их число ограничено
// квотой на человека, то есть выборка остаётся дешёвой.
const PUBLIC_CANDIDATE_LIMIT = 40
const OWN_CANDIDATE_LIMIT = 500

export async function findExistingNearDuplicate(
  fresh: { title: string; items: string[]; tags: string[] },
  opts: { ownerId?: string; excludeId?: string } = {},
): Promise<NearDupVerdict> {
  const tags = fresh.tags.filter((t) => t && t !== '*')
  // Кандидаты: публичные живые списки по пересечению тегов + все свои (свои сравниваем
  // всегда — повторно генерировать себе же одно и то же обиднее всего).
  const alive = and(sql`${templates.archivedAt} is null`, opts.excludeId ? sql`${templates.id} <> ${opts.excludeId}` : sql`true`)
  const pick = { id: templates.id, title: templates.title, currentVersion: templates.currentVersion }

  // ДВА запроса вместо одного с общим лимитом. Раньше стоял `limit(40)` БЕЗ сортировки:
  // у кого больше сорока подходящих списков (а это ровно сценарий массовой генерации,
  // ради которого проверка и заведена), в выборку попадали произвольные сорок — клон за
  // их пределами не сравнивался никогда и создавался как новый.
  const [own, byTag] = await Promise.all([
    opts.ownerId
      ? db.select(pick).from(templates).where(and(alive, eq(templates.ownerId, opts.ownerId))).orderBy(desc(templates.updatedAt)).limit(OWN_CANDIDATE_LIMIT)
      : Promise.resolve([]),
    tags.length
      ? db
          .select(pick)
          .from(templates)
          .where(and(alive, eq(templates.visibility, 'public'), eq(templates.status, 'published'), arrayOverlaps(templates.tags, tags)))
          // Свежие первыми: если резать пачку, то по понятному правилу, а не «как легло».
          .orderBy(desc(templates.updatedAt))
          .limit(PUBLIC_CANDIDATE_LIMIT)
      : Promise.resolve([]),
  ])
  const seen = new Set<string>()
  const rows = [...own, ...byTag].filter((r) => !seen.has(r.id) && seen.add(r.id))

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
