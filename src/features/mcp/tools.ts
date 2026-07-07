import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, runs, runStepState, steps, templates, users, type ProposedItem } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { getFeed, getTemplateDetail } from '@/features/library/queries'
import { canViewList } from '@/features/library/access'
import { dialectExt, normalizeDialect, toRunnableScript, type ExportList } from '@/features/library/export'
import { listStore } from '@/features/library/list-store'
import { uniqueSlug } from '@/features/library/slug'
import { emptyBlock, toProposedItems, type EditorItem } from '@/features/library/editor'
import { isBlockType, newOptionId } from '@/features/library/blocks'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://setfork.com').replace(/\/$/, '')

export interface McpBlockOption {
  text: string
  correct?: boolean // только для quiz — верный вариант
}

// Один блок списка через MCP. type по умолчанию 'step'. Поля по типу:
//  step  — title(+desc/command/level/why/section/subtasks); text — text(markdown);
//  image — caption(+imageRef); video — url(+caption); poll — question/options/multi/deadline;
//  quiz  — question/options(correct)/multi/explain.
export interface McpItemInput {
  type?: string
  title?: string
  desc?: string
  command?: string
  level?: 'required' | 'recommended' | 'optional'
  why?: string
  section?: string
  subtasks?: string[]
  text?: string
  caption?: string
  imageRef?: string
  url?: string
  question?: string
  options?: McpBlockOption[]
  multi?: boolean
  deadline?: string
  explain?: string
}

// MCP-контент нейтрален к языку → кладём под 'en' (locale-JSON, tr с фолбэком читает).
// Строим EditorItem-ы и прогоняем через общий сериализатор блоков (bid, poll/quiz/video
// content — та же логика, что у веб-редактора). Ноль дублирования блочной модели.
function toProposed(items: McpItemInput[]): ProposedItem[] {
  const editor: EditorItem[] = (items ?? []).map((it): EditorItem => {
    const type = isBlockType(it.type ?? '') ? (it.type as EditorItem['type']) : 'step'
    const b = emptyBlock(type)
    if (type === 'text') return { ...b, text: (it.text ?? '').trim() }
    if (type === 'image') return { ...b, imageKey: (it.imageRef ?? '').trim(), caption: (it.caption ?? '').trim() }
    if (type === 'video') return { ...b, videoUrl: (it.url ?? '').trim(), caption: (it.caption ?? '').trim() }
    if (type === 'poll')
      return { ...b, poll: { question: (it.question ?? '').trim(), options: (it.options ?? []).map((o) => ({ id: newOptionId(), text: (o.text ?? '').trim() })), multi: it.multi === true, deadline: (it.deadline ?? '').trim() } }
    if (type === 'quiz')
      return { ...b, quiz: { question: (it.question ?? '').trim(), options: (it.options ?? []).map((o) => ({ id: newOptionId(), text: (o.text ?? '').trim(), correct: o.correct === true })), multi: it.multi === true, explain: (it.explain ?? '').trim() } }
    return { ...b, title: (it.title ?? '').trim(), desc: (it.desc ?? '').trim(), command: it.command?.trim() ?? '', level: it.level ?? 'required', why: (it.why ?? '').trim(), section: (it.section ?? '').trim(), subtasks: (it.subtasks ?? []).filter((s) => s.trim()) }
  })
  return toProposedItems(editor, 'en')
}

// Прямая перезапись шагов версии (для in-place правки черновика; порт addVersion создаёт НОВУЮ).
// TODO(rust-boundary): вынести в порт (ListStore.replaceDraftSteps) при следующем проходе.
async function insertSteps(versionId: string, items: ProposedItem[]): Promise<void> {
  if (!items.length) return
  await db.insert(steps).values(
    items.map((it, i) => ({
      versionId,
      n: i + 1,
      type: it.type ?? 'step',
      content: it.content ?? {},
      title: it.title,
      desc: it.desc,
      command: it.command,
      hasImage: !!it.imageKey,
      imageKey: it.imageKey ?? null,
      level: it.level,
      why: it.why,
      section: it.section,
      subtasks: it.subtasks,
      refs: it.refs,
    })),
  )
}

/** ProposedItem[] → доменный вход шагов для ListStore.create/addVersion.
 *  Несёт type/content — иначе не-step блоки (poll/video/quiz/text/image) теряются. */
function stepInput(items: ProposedItem[]) {
  return items.map((it, i) => ({
    n: i + 1,
    type: it.type ?? 'step',
    content: it.content ?? {},
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

// Один блок списка → представление для MCP-контекста нейросети. Отдаём ВСЕ типы
// (не только шаги): текст/картинка/опрос/видео/тест — иначе AI видит лишь часть.
type DetailStep = NonNullable<Awaited<ReturnType<typeof getTemplateDetail>>>['steps'][number]
function blockForMcp(s: DetailStep) {
  const type = (s.type ?? 'step') as string
  const c = (s.content ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  if (type === 'text') return { n: s.n, type, text: str(c.md) }
  if (type === 'image') return { n: s.n, type, ref: str(c.ref) || undefined, caption: str(c.caption) || undefined }
  if (type === 'video') return { n: s.n, type, url: str(c.url), caption: str(c.caption) || undefined }
  if (type === 'poll' || type === 'quiz') {
    const opts = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : []
    return {
      n: s.n,
      type,
      question: str(c.question),
      options: opts.map((o) => (type === 'quiz' ? { text: str(o.text), correct: o.correct === true } : { text: str(o.text) })),
      multi: c.multi === true || undefined,
      ...(type === 'poll' ? { deadline: str(c.deadline) || undefined } : { explain: str(c.explain) || undefined }),
    }
  }
  return {
    n: s.n,
    type: 'step',
    title: tr(s.title, 'en'),
    desc: tr(s.desc, 'en'),
    command: s.command || undefined,
    level: s.level,
    why: tr(s.why, 'en') || undefined,
    subtasks: s.subtasks.map((x) => tr(x, 'en')).filter(Boolean),
    refs: s.refs.map((r) => ({ label: tr(r.label, 'en'), url: r.url })).filter((r) => r.label),
  }
}

export async function mcpGetList(userId: string, handle: string, slug: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl, currentVersion, steps } = detail
  // Тот же единый предикат приватности, что и на сайте (у MCP админа нет).
  if (!canViewList(tpl, { isOwner: tpl.ownerId === userId })) return null

  return {
    ref: `${handle}/${slug}`,
    title: tr(tpl.title, 'en'),
    desc: tr(tpl.desc, 'en'),
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    verified: tpl.verified,
    // Все блоки списка (шаги + текст/картинки/опросы/видео/тесты) — полный контекст.
    steps: steps.map(blockForMcp),
  }
}

// get_script: тот же список, но как готовый исполняемый скрипт (bash/ps1/py) —
// удобно агенту, который прогоняет чек-лист (CI-for-AI). Приватность как у get_list.
export async function mcpGetScript(userId: string, handle: string, slug: string, dialectRaw?: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl, currentVersion, steps } = detail
  if (!canViewList(tpl, { isOwner: tpl.ownerId === userId })) return null

  const dialect = normalizeDialect(dialectRaw)
  const url = `${SITE_URL}/${handle}/${slug}/raw`
  const list: ExportList = {
    title: tpl.title,
    desc: tpl.desc,
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    ownerHandle: handle,
    slug,
    steps: steps.map((s) => ({
      n: s.n,
      type: s.type,
      content: s.content,
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      subtasks: s.subtasks,
      refs: s.refs,
    })),
  }
  return {
    ref: `${handle}/${slug}`,
    dialect,
    filename: `${slug}.${dialectExt(dialect)}`,
    url: dialect === 'sh' ? url : `${url}?lang=${dialect}`,
    note: 'Commands come from the list authors — review before running.',
    script: toRunnableScript(list, 'en', url, dialect),
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
  // Только шаг-блоки, перенумерованные 1..K (индекс среди шагов) — это и есть N
  // для check_step. text/image в прогон не входят.
  const stepRows = await db.select({ id: steps.id, title: steps.title }).from(steps).where(and(eq(steps.versionId, run.versionId), eq(steps.type, 'step'))).orderBy(steps.n)
  const states = await db.select({ stepId: runStepState.stepId, status: runStepState.status, note: runStepState.note }).from(runStepState).where(eq(runStepState.runId, runId))
  const byStep = new Map(states.map((s) => [s.stepId, s]))
  const stepsOut = stepRows.map((s, i) => {
    const st = byStep.get(s.id)
    return {
      n: i + 1,
      title: tr(s.title, 'en'),
      done: st?.status === 'done',
      blocked: st?.status === 'blocked',
      reason: st?.status === 'blocked' && st.note ? st.note : undefined,
    }
  })
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
    // Чекаются только шаг-блоки; text/image — контекст, состояние им не заводим.
    const stepRows = await db.select({ id: steps.id }).from(steps).where(and(eq(steps.versionId, cur.id), eq(steps.type, 'step')))
    if (stepRows.length) await db.insert(runStepState).values(stepRows.map((s) => ({ runId: r.id, stepId: s.id })))
    await db.update(templates).set({ runsCount: sql`${templates.runsCount} + 1` }).where(eq(templates.id, tpl.id))
  }
  return mcpRunState(userId, runId)
}

/** Текущее состояние прогона по его id. */
export async function mcpGetRun(userId: string, runId: string) {
  return mcpRunState(userId, runId)
}

/**
 * Отметить шаг прогона по номеру N (CI-стиль для агента):
 * blocked=true → «упал» + причина; done=true/false → выполнен/нет; иначе — тоггл done.
 */
export async function mcpCheckStep(userId: string, runId: string, stepN: number, opts?: { done?: boolean; blocked?: boolean; reason?: string }) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== userId) return { error: 'run not found' }
  // N — индекс среди ШАГ-блоков (1..K), а не steps.n (тот включает text/image).
  const stepBlocks = await db.select({ id: steps.id }).from(steps).where(and(eq(steps.versionId, run.versionId), eq(steps.type, 'step'))).orderBy(steps.n)
  const st = stepBlocks[stepN - 1]
  if (!st) return { error: 'step not found' }
  const [state] = await db.select().from(runStepState).where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, st.id))).limit(1)
  if (!state) return { error: 'step state not found' }

  if (opts?.blocked) {
    await db
      .update(runStepState)
      .set({ status: 'blocked', note: (opts.reason ?? '').trim().slice(0, 500), doneAt: null })
      .where(eq(runStepState.id, state.id))
  } else {
    const target = opts?.done === undefined ? (state.status === 'done' ? 'todo' : 'done') : opts.done ? 'done' : 'todo'
    await db.update(runStepState).set({ status: target, note: '', doneAt: target === 'done' ? new Date() : null }).where(eq(runStepState.id, state.id))
  }
  // Пересчёт doneCount (зеркало runs/actions.recountDone).
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.status, 'done')))
  await db.update(runs).set({ doneCount: c, updatedAt: new Date() }).where(eq(runs.id, runId))
  return mcpRunState(userId, runId)
}
