import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, steps, templateVersions, templates, users, type ProposedItem } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { getFeed, getTemplateDetail } from '@/features/library/queries'
import { uniqueSlug } from '@/features/library/slug'

export interface McpItemInput {
  title: string
  desc?: string
  command?: string
  level?: 'required' | 'recommended' | 'optional'
  why?: string
  section?: string
  subtasks?: string[]
}

const LEVELS = ['required', 'recommended', 'optional']

// MCP-контент нейтрален к языку → кладём под 'en' (locale-JSON, tr с фолбэком читает).
function toProposed(items: McpItemInput[]): ProposedItem[] {
  return items
    .filter((it) => it.title?.trim())
    .map((it) => ({
      title: { en: it.title.trim() },
      desc: it.desc?.trim() ? { en: it.desc.trim() } : {},
      command: it.command?.trim() ?? '',
      hasImage: false,
      level: (LEVELS.includes(it.level as string) ? it.level : 'required') as ProposedItem['level'],
      why: it.why?.trim() ? { en: it.why.trim() } : {},
      section: it.section?.trim() ? { en: it.section.trim() } : {},
      subtasks: (it.subtasks ?? []).filter((s) => s.trim()).map((s) => ({ en: s.trim() })),
      refs: [],
    }))
}

async function insertSteps(versionId: string, items: ProposedItem[]): Promise<void> {
  if (!items.length) return
  await db.insert(steps).values(
    items.map((it, i) => ({
      versionId,
      n: i + 1,
      title: it.title,
      desc: it.desc,
      command: it.command,
      hasImage: false,
      imageKey: null,
      level: it.level,
      why: it.why,
      section: it.section,
      subtasks: it.subtasks,
      refs: it.refs,
    })),
  )
}

// Инструменты MCP работают от имени пользователя токена (userId).
// Приватность соблюдается: getFeed/visibleFilter уже фильтруют по viewerId,
// get_list проверяет доступ явно. Контент отдаём в EN (locale-JSON, tr с фолбэком).

export async function mcpSearch(userId: string, query: string, limit: number) {
  const feed = await getFeed({ q: query }, userId)
  return {
    query,
    count: Math.min(feed.length, limit),
    results: feed.slice(0, limit).map((f) => ({
      ref: `${f.ownerHandle}/${f.slug}`,
      title: tr(f.title, 'en'),
      desc: tr(f.desc, 'en'),
      tags: f.tags,
      version: f.version,
      stars: f.starsCount,
      verified: f.verified,
    })),
  }
}

export async function mcpGetList(userId: string, handle: string, slug: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl, currentVersion, steps } = detail
  const isOwner = tpl.ownerId === userId
  // Те же гарантии, что и на странице: чужое приватное/черновик/скрытое не отдаём.
  if (tpl.visibility === 'private' && !isOwner) return null
  if (tpl.status === 'draft' && !isOwner) return null
  if (tpl.moderation !== 'active' && !isOwner) return null

  return {
    ref: `${handle}/${slug}`,
    title: tr(tpl.title, 'en'),
    desc: tr(tpl.desc, 'en'),
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    verified: tpl.verified,
    steps: steps.map((s) => ({
      n: s.n,
      title: tr(s.title, 'en'),
      desc: tr(s.desc, 'en'),
      command: s.command || undefined,
      level: s.level,
      why: tr(s.why, 'en') || undefined,
      subtasks: s.subtasks.map((x) => tr(x, 'en')).filter(Boolean),
      refs: s.refs.map((r) => ({ label: tr(r.label, 'en'), url: r.url })).filter((r) => r.label),
    })),
  }
}

export interface McpCreateInput {
  title: string
  desc?: string
  tags?: string[]
  ordered?: boolean
  items: McpItemInput[]
}

/** Создать список от имени пользователя. Всегда как ЧЕРНОВИК — публикует потом владелец на сайте. */
export async function mcpCreateList(userId: string, input: McpCreateInput) {
  const title = input.title?.trim()
  if (!title) return { error: 'title is required' }
  const proposed = toProposed(input.items ?? [])
  if (!proposed.length) return { error: 'at least one item with a title is required' }

  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  const slug = await uniqueSlug(title, userId)
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8)

  const [tpl] = await db
    .insert(templates)
    .values({
      ownerId: userId,
      slug,
      title: { en: title },
      desc: input.desc?.trim() ? { en: input.desc.trim() } : {},
      tags,
      currentVersion: 1,
      origin: 'authored',
      status: 'draft',
      ordered: input.ordered ?? true,
    })
    .returning()
  const [ver] = await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'created via API' }).returning()
  await insertSteps(ver.id, proposed)

  return {
    ref: `${u.handle}/${slug}`,
    status: 'draft',
    note: 'Created as a private draft — the owner publishes it on the site to make it public.',
  }
}

export interface McpUpdateInput {
  items: McpItemInput[]
  note?: string
  tags?: string[]
  ordered?: boolean
}

/** Обновить список (только владелец). Черновик — правим на месте; опубликованный — новая версия. */
export async function mcpUpdateList(userId: string, handle: string, slug: string, input: McpUpdateInput) {
  const owner = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!owner[0]) return { error: 'list not found' }
  const tpl = await db.query.templates.findFirst({
    where: (t) => and(eq(t.ownerId, owner[0].id), eq(t.slug, slug)),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return { error: 'list not found' }
  if (tpl.ownerId !== userId) return { error: 'forbidden: you are not the owner' }

  const proposed = toProposed(input.items ?? [])
  if (!proposed.length) return { error: 'at least one item with a title is required' }
  const tags = input.tags
    ? input.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8)
    : tpl.tags

  if (tpl.status === 'draft') {
    // черновик — перезаписываем текущую версию на месте (без плодения версий)
    const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
    await db.delete(steps).where(eq(steps.versionId, cur.id))
    await insertSteps(cur.id, proposed)
    await db.update(templates).set({ tags, ordered: input.ordered ?? tpl.ordered, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
    return { ref: `${handle}/${slug}`, status: 'draft', version: cur.version }
  }

  const newVersion = tpl.currentVersion + 1
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: newVersion, note: input.note?.trim() || 'updated via API' })
    .returning()
  await insertSteps(ver.id, proposed)
  await db
    .update(templates)
    .set({ currentVersion: newVersion, tags, ordered: input.ordered ?? tpl.ordered, updatedAt: new Date() })
    .where(eq(templates.id, tpl.id))
  return { ref: `${handle}/${slug}`, status: 'published', version: newVersion }
}
