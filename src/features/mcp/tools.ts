import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, runs, runStepState, steps, templates, users, type ProposedItem } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { getFeed, getTemplateDetail } from '@/features/library/queries'
import { listStore } from '@/features/library/list-store.adapter'
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

// Прямая перезапись шагов версии (для in-place правки черновика; порт addVersion создаёт НОВУЮ).
// TODO(rust-boundary): вынести в порт (ListStore.replaceDraftSteps) при следующем проходе.
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

/** ProposedItem[] → доменный вход шагов для ListStore.create/addVersion. */
function stepInput(items: ProposedItem[]) {
  return items.map((it, i) => ({
    n: i + 1,
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    section: it.section,
    subtasks: it.subtasks,
    refs: it.refs,
    imageRef: it.imageKey ?? null,
  }))
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

  await listStore.create({
    ownerId: userId,
    slug,
    title: { en: title },
    desc: input.desc?.trim() ? { en: input.desc.trim() } : {},
    tags,
    ordered: input.ordered ?? true,
    visibility: 'public',
    status: 'draft',
    origin: 'authored',
    note: 'created via API',
    steps: stepInput(proposed),
  })

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

  const ver = await listStore.addVersion(tpl.id, { note: input.note?.trim() || 'updated via API', steps: stepInput(proposed) })
  await db
    .update(templates)
    .set({ tags, ordered: input.ordered ?? tpl.ordered, updatedAt: new Date() })
    .where(eq(templates.id, tpl.id))
  return { ref: `${handle}/${slug}`, status: 'published', version: ver.version }
}

// ── Прогоны (runs): запуск/просмотр/отметка шагов через MCP ──────────
// Логика зеркалит features/runs, но принимает userId из токена (не session).

/** Состояние прогона: список шагов с отметками + прогресс. */
async function mcpRunState(userId: string, runId: string) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== userId) return { error: 'run not found' }
  const [meta] = await db
    .select({ slug: templates.slug, ownerHandle: users.handle })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(eq(templates.id, run.templateId))
    .limit(1)
  const stepRows = await db.select({ id: steps.id, n: steps.n, title: steps.title }).from(steps).where(eq(steps.versionId, run.versionId)).orderBy(steps.n)
  const states = await db.select({ stepId: runStepState.stepId, status: runStepState.status }).from(runStepState).where(eq(runStepState.runId, runId))
  const doneSet = new Set(states.filter((s) => s.status === 'done').map((s) => s.stepId))
  const stepsOut = stepRows.map((s) => ({ n: s.n, title: tr(s.title, 'en'), done: doneSet.has(s.id) }))
  return {
    runId,
    ref: meta ? `${meta.ownerHandle}/${meta.slug}` : undefined,
    version: run.version,
    status: run.status,
    progress: { done: stepsOut.filter((s) => s.done).length, total: stepsOut.length },
    steps: stepsOut,
  }
}

/** Запустить (или продолжить активный) прогон списка по текущей версии. */
export async function mcpStartRun(userId: string, handle: string, slug: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return { error: 'list not found' }
  const { tpl, currentVersion } = detail
  const isOwner = tpl.ownerId === userId
  if (tpl.visibility === 'private' && !isOwner) return { error: 'forbidden' }
  if (tpl.status === 'draft' && !isOwner) return { error: 'forbidden' }
  if (tpl.moderation !== 'active' && !isOwner) return { error: 'forbidden' }
  const cur = currentVersion
  if (!cur) return { error: 'list has no version' }

  const existing = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.templateId, tpl.id), eq(runs.versionId, cur.id), eq(runs.status, 'active')))
    .limit(1)
  let runId = existing[0]?.id
  if (!runId) {
    const [r] = await db.insert(runs).values({ templateId: tpl.id, versionId: cur.id, version: cur.version, userId }).returning()
    runId = r.id
    const stepRows = await db.select({ id: steps.id }).from(steps).where(eq(steps.versionId, cur.id))
    if (stepRows.length) await db.insert(runStepState).values(stepRows.map((s) => ({ runId: r.id, stepId: s.id })))
    await db.update(templates).set({ runsCount: sql`${templates.runsCount} + 1` }).where(eq(templates.id, tpl.id))
  }
  return mcpRunState(userId, runId)
}

/** Текущее состояние прогона по его id. */
export async function mcpGetRun(userId: string, runId: string) {
  return mcpRunState(userId, runId)
}

/** Отметить/снять шаг прогона по его номеру N (или задать явно через done). */
export async function mcpCheckStep(userId: string, runId: string, stepN: number, done?: boolean) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== userId) return { error: 'run not found' }
  const [st] = await db.select({ id: steps.id }).from(steps).where(and(eq(steps.versionId, run.versionId), eq(steps.n, stepN))).limit(1)
  if (!st) return { error: 'step not found' }
  const [state] = await db.select().from(runStepState).where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, st.id))).limit(1)
  if (!state) return { error: 'step state not found' }
  const target = done === undefined ? (state.status === 'done' ? 'todo' : 'done') : done ? 'done' : 'todo'
  await db.update(runStepState).set({ status: target, doneAt: target === 'done' ? new Date() : null }).where(eq(runStepState.id, state.id))
  // Пересчёт doneCount (зеркало runs/actions.recountDone).
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.status, 'done')))
  await db.update(runs).set({ doneCount: c, updatedAt: new Date() }).where(eq(runs.id, runId))
  return mcpRunState(userId, runId)
}
