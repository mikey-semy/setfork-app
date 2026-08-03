import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, knowledgeSources, runs, runStepState, steps, suggestionReportedChecks, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { tr } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- MCP: доступ по userId токена (нет cookie-сессии/админа), canViewList на месте у каждого вызова
import { getFeed, getTemplateDetail } from '@/features/library/queries'
import { canEditList, canViewList } from '@/core'
import { listQuota } from '@/shared/quota'
import { detectTextLang } from '@/shared/lib/translit'
import { dialectExt, normalizeDialect, toExportList, toRunnableScript } from '@/features/library/export'
import { listStore } from '@/features/library/list-store'
import { applySuggestion, createSuggestion, mergeSuggestion, reviewSuggestion, revertSuggestion } from '@/features/library/suggestion-core'
import { slugify, uniqueSlug } from '@/features/library/slug'
import { recordAgentAction } from '@/shared/agents/policy'
import { findExistingNearDuplicate } from '@/shared/ai/near-dup-check'
import { attributionLine, checkLicense } from '@/shared/ai/source-license'
import { emptyBlock, toProposedItems, type EditorItem } from '@/features/library/editor'
import { isBlockType, newOptionId } from '@/features/library/blocks'
import { isCollaborator } from '@/features/collab/queries'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { REPORTED_STATUSES, reportedChecks, type ReportedStatus } from '@/features/library/suggestion-checks'
import { currentRevision } from '@/features/library/suggestion-core'
import { recordRunCompletionIfDone } from '@/shared/completion'
import { getCourseCompletion } from '@/features/quizzes/queries'

// Единая проверка «зритель вправе видеть» для MCP: тот же canViewList, что и на
// сайте, но коллаборатора (для приватного/черновика) досчитываем лениво.
async function mcpCanView(tpl: { id: string; ownerId: string; visibility: 'public' | 'private'; status: 'draft' | 'published'; moderation: string }, userId: string): Promise<boolean> {
  const isOwner = tpl.ownerId === userId
  const isCollab = !isOwner && (tpl.visibility === 'private' || tpl.status === 'draft') ? await isCollaborator(tpl.id, userId) : false
  return canViewList(tpl, { isOwner, isCollaborator: isCollab })
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://setfork.com').replace(/\/$/, '')

export interface McpBlockOption {
  text: string
  correct?: boolean // только для quiz — верный вариант
}

// Один блок списка через MCP. type по умолчанию 'step'. Поля по типу:
//  step  — title(+desc/command/level/why/section/subtasks/refs); text — text(markdown);
//  file  — url + fileName (ссылка на документ/вложение);
//  image — caption(+imageRef); video — url(+caption); poll — question/options/multi/deadline;
//  quiz  — question/explain + по quizKind: choice=options(correct)/multi;
//          text=accept/caseSensitive; number=answer/tolerance.
export interface McpItemInput {
  type?: string
  title?: string
  desc?: string
  command?: string
  level?: 'required' | 'recommended' | 'optional'
  why?: string
  section?: string
  subtasks?: string[]
  refs?: { label: string; url?: string }[] // step — ссылки под шагом (док, источник)
  text?: string
  caption?: string
  imageRef?: string
  url?: string
  fileName?: string // file — имя вложения (url = ссылка на уже загруженный файл)
  question?: string
  options?: McpBlockOption[]
  multi?: boolean
  deadline?: string
  explain?: string
  quizKind?: string // 'choice'(default)|'text'|'number'|'blank'
  accept?: string[] // quiz text
  caseSensitive?: boolean // quiz text/blank
  answer?: number // quiz number
  tolerance?: number // quiz number
  template?: string // quiz blank — текст с '___'
  blanks?: string[][] // quiz blank — принимаемые ответы на каждый пропуск
  pairs?: { left: string; right: string }[] // quiz match — пары для сопоставления
  sortItems?: string[] // quiz sort — элементы в ПРАВИЛЬНОМ порядке
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
    if (type === 'file') return { ...b, fileUrl: (it.url ?? '').trim(), fileName: (it.fileName ?? '').trim() }
    if (type === 'poll')
      return { ...b, poll: { question: (it.question ?? '').trim(), options: (it.options ?? []).map((o) => ({ id: newOptionId(), text: (o.text ?? '').trim() })), multi: it.multi === true, deadline: (it.deadline ?? '').trim() } }
    if (type === 'quiz') {
      const KINDS = ['text', 'number', 'blank', 'match', 'sort', 'code'] as const
      const kind = (KINDS as readonly string[]).includes(it.quizKind ?? '') ? (it.quizKind as (typeof KINDS)[number]) : 'choice'
      return {
        ...b,
        quiz: {
          ...b.quiz,
          kind,
          question: (it.question ?? '').trim(),
          options: (it.options ?? []).map((o) => ({ id: newOptionId(), text: (o.text ?? '').trim(), correct: o.correct === true })),
          multi: it.multi === true,
          accept: (it.accept ?? []).map((a) => String(a)),
          caseSensitive: it.caseSensitive === true,
          answer: typeof it.answer === 'number' ? String(it.answer) : '',
          tolerance: typeof it.tolerance === 'number' ? String(it.tolerance) : '',
          template: (it.template ?? '').toString(),
          blanks: (it.blanks ?? []).map((b2) => (Array.isArray(b2) ? b2.map((x) => String(x)).join(', ') : String(b2))),
          pairs: (it.pairs ?? []).map((p) => ({ left: String(p?.left ?? ''), right: String(p?.right ?? '') })),
          items: (it.sortItems ?? []).map((s) => String(s)),
          explain: (it.explain ?? '').trim(),
        },
      }
    }
    return {
      ...b,
      title: (it.title ?? '').trim(),
      desc: (it.desc ?? '').trim(),
      command: it.command?.trim() ?? '',
      level: it.level ?? 'required',
      why: (it.why ?? '').trim(),
      section: (it.section ?? '').trim(),
      subtasks: (it.subtasks ?? []).filter((s) => s.trim()),
      // Ссылки шага: get_list их отдаёт, а положить было нечем — асимметрия чтения
      // и записи. Пустые метки отсеивает сериализатор (toProposedItems).
      refs: (it.refs ?? []).map((r) => ({ label: String(r?.label ?? '').trim(), url: String(r?.url ?? '').trim() })),
    }
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
  if (type === 'file') return { n: s.n, type, url: str(c.url), name: str(c.name) }
  if (type === 'poll') {
    const opts = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : []
    return { n: s.n, type, question: str(c.question), options: opts.map((o) => ({ text: str(o.text) })), multi: c.multi === true || undefined, deadline: str(c.deadline) || undefined }
  }
  if (type === 'quiz') {
    const KINDS = ['text', 'number', 'blank', 'match', 'sort', 'code']
    const kind = KINDS.includes(c.kind as string) ? (c.kind as string) : 'choice'
    const base = { n: s.n, type, quizKind: kind, question: str(c.question), explain: str(c.explain) || undefined }
    if (kind === 'text' || kind === 'code') return { ...base, accept: Array.isArray(c.accept) ? (c.accept as unknown[]).map((a) => str(a)) : [], caseSensitive: c.caseSensitive === true || undefined }
    if (kind === 'sort') return { ...base, sortItems: Array.isArray(c.items) ? (c.items as unknown[]).map((x) => str(x)) : [], caseSensitive: c.caseSensitive === true || undefined }
    if (kind === 'number') return { ...base, answer: typeof c.answer === 'number' ? c.answer : undefined, tolerance: typeof c.tolerance === 'number' ? c.tolerance : undefined }
    if (kind === 'blank')
      return { ...base, template: str(c.template), blanks: Array.isArray(c.blanks) ? (c.blanks as unknown[]).map((b) => (Array.isArray(b) ? b.map((x) => str(x)) : [str(b)])) : [], caseSensitive: c.caseSensitive === true || undefined }
    if (kind === 'match')
      return { ...base, pairs: Array.isArray(c.pairs) ? (c.pairs as Record<string, unknown>[]).map((p) => ({ left: str(p.left), right: str(p.right) })) : [], caseSensitive: c.caseSensitive === true || undefined }
    const opts = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : []
    return { ...base, options: opts.map((o) => ({ text: str(o.text), correct: o.correct === true })), multi: c.multi === true || undefined }
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
  if (!(await mcpCanView(tpl, userId))) return null

  return {
    ref: `${handle}/${slug}`,
    title: tr(tpl.title, 'en'),
    desc: tr(tpl.desc, 'en'),
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    verified: tpl.verified,
    // Все блоки списка (шаги + текст/картинки/опросы/видео/тесты) — полный контекст.
    // section = заголовок урока/секции (для контекста границ уроков у AI).
    steps: steps.map((s) => ({ ...blockForMcp(s), section: tr(s.section, 'en') || undefined })),
  }
}

// get_script: тот же список, но как готовый исполняемый скрипт (bash/ps1/py) —
// удобно агенту, который прогоняет список (CI-for-AI). Приватность как у get_list.
export async function mcpGetScript(userId: string, handle: string, slug: string, dialectRaw?: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl } = detail
  if (!(await mcpCanView(tpl, userId))) return null

  const dialect = normalizeDialect(dialectRaw)
  const url = `${SITE_URL}/${handle}/${slug}/raw`
  const list = toExportList(detail)
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
  /** Язык контента ('ru'|'en'); не задан — детект по заголовку/описанию. */
  lang?: string
}

/** Создать список от имени пользователя. Всегда как ЧЕРНОВИК — публикует потом владелец на сайте. */
export async function mcpCreateList(userId: string, input: McpCreateInput) {
  const title = input.title?.trim()
  if (!title) return { error: 'title is required' }
  const proposed = toProposed(input.items ?? [])
  if (!proposed.length) return { error: 'at least one item with a title is required' }

  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  // Тот же лимит на число списков, что и в вебе (createTemplate) — MCP-путь его обходил.
  if (!(await listQuota(userId, u?.handle)).ok) return { error: 'list quota reached — delete a list first' }
  const slug = await uniqueSlug(title, userId)
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8)
  // Локаль заголовка/описания: явный lang из запроса или детект по тексту —
  // раньше всё хардкодилось в {en:} и русский список получал бейдж EN.
  const lang = input.lang === 'ru' || input.lang === 'en' ? input.lang : detectTextLang(`${title} ${input.desc ?? ''}`)

  await listStore.create({
    ownerId: userId,
    slug,
    title: { [lang]: title },
    desc: input.desc?.trim() ? { [lang]: input.desc.trim() } : {},
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

/**
 * МАССОВОЕ СОЗДАНИЕ — ускоритель ПОД РУКОЙ ЧЕЛОВЕКА, а не автономная петля.
 *
 * Цель компании — наполнить портал; часть фактуры быстрее получить пачкой через ассистента,
 * чем ждать проходов петли. Но пачка опасна ровно тем, чем полезна: одним вызовом можно
 * налить сотню мусорных списков. Поэтому три ограничения, все обязательные:
 *
 *   1. СУХОЙ ПРОГОН по умолчанию: сначала видно, что БУДЕТ создано (слаг, дубль ли),
 *      и только осознанный `dryRun: false` пишет. Ошибиться в сотне списков молча нельзя;
 *   2. ДЕДУП по нормализованному заголовку среди своих списков: повторный вызов после
 *      обрыва не удваивает библиотеку (идемпотентность по смыслу, а не по случайному ключу);
 *   3. КВОТА и ЧЕРНОВИК как в одиночном создании: пачка не обходит лимит и не публикует.
 *
 * Каждая пачка пишется в журнал действий (principal_mode='on_behalf_of'): видно, что это
 * сделал человек через ассистента, а не петля сама.
 */
export const MCP_BULK_MAX = 25

/** Нормализация заголовка для дедупа: регистр/пунктуация/пробелы не считаются различием. */
const titleKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export interface McpBulkResult {
  dryRun: boolean
  planned: number
  created: number
  duplicates: number
  failed: number
  quotaStopped: boolean
  lists: { title: string; ref?: string; slug?: string; status: 'created' | 'would-create' | 'duplicate' | 'error'; reason?: string }[]
}

export async function mcpBulkCreate(userId: string, lists: McpCreateInput[], dryRun = true): Promise<McpBulkResult | { error: string }> {
  const batch = (lists ?? []).filter((l) => l?.title?.trim())
  if (!batch.length) return { error: 'nothing to create: every entry needs a title' }
  if (batch.length > MCP_BULK_MAX) return { error: `too many lists in one call: ${batch.length} > ${MCP_BULK_MAX}` }

  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  const mine = await db.select({ title: templates.title }).from(templates).where(eq(templates.ownerId, userId))
  const seen = new Set(mine.map((r) => titleKey(Object.values((r.title ?? {}) as Record<string, string>).find(Boolean) ?? '')).filter(Boolean))

  const out: McpBulkResult = { dryRun, planned: batch.length, created: 0, duplicates: 0, failed: 0, quotaStopped: false, lists: [] }
  for (const input of batch) {
    const title = input.title.trim()
    const key = titleKey(title)
    if (key && seen.has(key)) {
      out.duplicates++
      out.lists.push({ title, status: 'duplicate', reason: 'you already have a list with this title' })
      continue
    }
    // Квоту проверяем ПЕРЕД каждым списком: пачка не должна пробивать лимит «с разгона».
    if (!(await listQuota(userId, u?.handle)).ok) {
      out.quotaStopped = true
      out.lists.push({ title, status: 'error', reason: 'list quota reached' })
      out.failed++
      break
    }
    // ПОЧТИ-ДУБЛЬ по содержимому, а не по заголовку: пачка — главный способ наплодить
    // клонов («Как испечь хлеб дома» и «Печём хлеб дома своими руками» с теми же шагами).
    // Считается кодом, порог измерен (см. shared/ai/near-duplicate). Проверяем и в сухом
    // прогоне: план обязан говорить правду о том, что будет создано.
    const near = await findExistingNearDuplicate(
      { title, items: (input.items ?? []).map((it) => it.title ?? '').filter(Boolean), tags: input.tags ?? [] },
      { ownerId: userId },
    )
    if (near.match) {
      out.duplicates++
      out.lists.push({ title, status: 'duplicate', reason: `почти дубль «${near.match.title}» (совпадение ${Math.round(near.match.score * 100)}%)` })
      continue
    }
    if (dryRun) {
      seen.add(key)
      out.lists.push({ title, status: 'would-create', slug: slugify(title) })
      continue
    }
    const res = await mcpCreateList(userId, input)
    if ('error' in res) {
      out.failed++
      out.lists.push({ title, status: 'error', reason: res.error as string })
      continue
    }
    seen.add(key)
    out.created++
    out.lists.push({ title, status: 'created', ref: res.ref })
  }

  await recordAgentAction({
    loop: 'mcp',
    action: 'list.bulk',
    resultStatus: out.failed && !out.created ? 'error' : dryRun ? 'dry-run' : 'ok',
    actorUserId: userId,
    principalMode: 'on_behalf_of',
    signal: { planned: out.planned, duplicates: out.duplicates, nearDuplicates: out.lists.filter((l) => l.reason?.startsWith('почти дубль')).length },
    decision: { dryRun, created: out.created, failed: out.failed, quotaStopped: out.quotaStopped },
  })
  return out
}

/**
 * Принять правку своего списка. Нужно затем, что правки компании копились без разбора:
 * заходить на страницу каждой — работа, а из ассистента это одна фраза.
 * Логика приёма НЕ дублируется — зовём то же ядро, что и кнопка на сайте.
 */
export async function mcpApplySuggestion(userId: string, suggestionId: string) {
  const res = await applySuggestion(suggestionId, userId)
  if (!res.ok) return { error: res.reason }
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return { ref: `${u?.handle ?? ''}/${res.slug}`, version: res.version, note: 'Accepted — a new version was created.' }
}

/**
 * Отчёт внешней проверки о предложении — наш аналог status check.
 *
 * Кто вправе отчитываться: владелец списка и коллаборанты. НЕ автор предложения:
 * проверки видны рядом с гейтами слияния, и «сам себе поставил зелёное» превратило
 * бы их в украшение. Своё предложение автор всё равно не принимает сам.
 *
 * Ключ — пара (предложение, имя): повторный отчёт ОБНОВЛЯЕТ прежний. Длинный прогон
 * так и работает: сначала 'pending', потом настоящий итог.
 */
export async function mcpReportCheck(
  userId: string,
  input: { list: string; number: number; name: string; status: string; summary?: string; url?: string },
) {
  const name = input.name.trim().slice(0, 60)
  if (!name) return { error: 'name is required' }
  if (!(REPORTED_STATUSES as readonly string[]).includes(input.status)) {
    return { error: `status must be one of: ${REPORTED_STATUSES.join(', ')}` }
  }
  // Ссылка на лог — снаружи, поэтому только http(s): javascript:/data: в атрибуте
  // href на странице предложения были бы дырой, а не удобством.
  const url = (input.url ?? '').trim()
  if (url && !/^https?:\/\//i.test(url)) return { error: 'url must be http(s)' }

  const ref = input.list.includes('/') ? input.list.split('/') : [null, input.list]
  const [tpl] = await db
    .select({ id: templates.id, ownerId: templates.ownerId, slug: templates.slug })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(ref[0] ? and(eq(users.handle, ref[0]), eq(templates.slug, ref[1]!)) : eq(templates.slug, ref[1]!))
    .limit(1)
  if (!tpl) return { error: 'list not found' }
  if (tpl.ownerId !== userId && !(await isCollaborator(tpl.id, userId))) {
    return { error: 'only the list owner or a collaborator can report checks' }
  }

  const [sug] = await db
    .select({ id: suggestions.id, authorId: suggestions.authorId, status: suggestions.status, branchRef: suggestions.branchRef, items: suggestions.items, templateId: suggestions.templateId })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, tpl.id), eq(suggestions.number, input.number)))
    .limit(1)
  if (!sug) return { error: 'suggestion not found' }
  if (sug.status !== 'open') return { error: 'suggestion is closed' }

  // К КАКОЙ ревизии относится отчёт. Без этого «ок» жил вечно: автор дописывал
  // предложение и сливал непроверенное.
  const revision = await currentRevision(sug)
  await db
    .insert(suggestionReportedChecks)
    .values({
      suggestionId: sug.id,
      name,
      status: input.status as ReportedStatus,
      revision,
      summary: (input.summary ?? '').trim().slice(0, 500) || null,
      url: url || null,
      reporterId: userId,
    })
    .onConflictDoUpdate({
      target: [suggestionReportedChecks.suggestionId, suggestionReportedChecks.name],
      set: {
        status: input.status as ReportedStatus,
        revision,
        summary: (input.summary ?? '').trim().slice(0, 500) || null,
        url: url || null,
        reporterId: userId,
        updatedAt: new Date(),
      },
    })

  const all = await reportedChecks(sug.id)
  return {
    reported: name,
    status: input.status,
    url: `${SITE_URL}/${ref[0] ?? ''}/${tpl.slug}/suggestions/${input.number}?tab=checks`,
    checks: all.map((c) => ({ name: c.title, status: c.status, summary: c.detail })),
  }
}

/**
 * Предложить правку к списку через MCP.
 *
 * Ворота те же, что у формы (их держит ядро): видимость списка, архив/заморозка,
 * настройка «кто может предлагать», кап на автора. Агент здесь такой же участник,
 * как человек, — и правка так же ждёт решения владельца, а не применяется сама.
 */
export async function mcpSuggestEdit(
  userId: string,
  input: { list: string; note: string; items: McpItemInput[] },
) {
  const tpl = await resolveListRef(input.list)
  if (!tpl) return { error: 'list not found' }
  const items = toProposed(input.items ?? [])
  if (items.length === 0) return { error: 'items must not be empty — a suggestion with no changes has nothing to accept' }
  const res = await createSuggestion(userId, tpl.id, { note: input.note ?? '', items })
  if (!res.ok) return { error: res.reason }
  return {
    id: res.id,
    number: res.number,
    url: `${SITE_URL}/${tpl.ownerHandle}/${tpl.slug}/suggestions/${res.number ?? res.id}`,
    note: 'Suggested — the list owner decides whether to accept it.',
  }
}

/** Оставить вердикт по предложению: одобрить, попросить правки или просто высказаться. */
export async function mcpReviewSuggestion(userId: string, input: { list: string; number: number; verdict: string; body?: string }) {
  const sug = await resolveSuggestionRef(input.list, input.number)
  if ('error' in sug) return sug
  const res = await reviewSuggestion(userId, sug.id, input.verdict, input.body ?? '')
  return res.ok ? { reviewed: input.number, verdict: res.verdict } : { error: res.reason }
}

/** Влить предложение (ветка или пункты — ядро решает само). */
export async function mcpMergeSuggestion(userId: string, input: { list: string; number: number }) {
  const sug = await resolveSuggestionRef(input.list, input.number)
  if ('error' in sug) return sug
  const res = await mergeSuggestion(sug.id, userId)
  if (!res.ok) return { error: res.reason }
  return {
    merged: input.number,
    kind: res.kind,
    version: res.version,
    url: `${SITE_URL}/${res.owner}/${res.slug}`,
  }
}

/** Откатить принятое предложение: создаётся НОВОЕ, отменяющее его. */
export async function mcpRevertSuggestion(userId: string, input: { list: string; number: number }) {
  const sug = await resolveSuggestionRef(input.list, input.number)
  if ('error' in sug) return sug
  const res = await revertSuggestion(userId, sug.id)
  if (!res.ok) {
    return { error: res.conflicts?.length ? `${res.reason}: ${res.conflicts.map((c) => c.title).join(', ')}` : res.reason }
  }
  return { revertOf: input.number, opened: res.number, note: 'A revert suggestion was opened — it still needs review and merging.' }
}

/** Список по ссылке «handle/slug» или просто «slug». */
async function resolveListRef(ref: string): Promise<{ id: string; slug: string; ownerHandle: string } | null> {
  const parts = ref.includes('/') ? ref.split('/') : [null, ref]
  const [row] = await db
    .select({ id: templates.id, slug: templates.slug, ownerHandle: users.handle })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(parts[0] ? and(eq(users.handle, parts[0]), eq(templates.slug, parts[1]!)) : eq(templates.slug, parts[1]!))
    .limit(1)
  return row ?? null
}

/** Предложение по паре «список + номер» — человеческий адрес, тот же, что в UI. */
async function resolveSuggestionRef(ref: string, number: number): Promise<{ id: string } | { error: string }> {
  const tpl = await resolveListRef(ref)
  if (!tpl) return { error: 'list not found' }
  const [row] = await db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, tpl.id), eq(suggestions.number, number)))
    .limit(1)
  return row ? { id: row.id } : { error: 'suggestion not found' }
}

/** Открытые правки на списках пользователя — что вообще ждёт его решения. */
export async function mcpPendingSuggestions(userId: string, limit = 20) {
  const rows = await db
    .select({
      id: suggestions.id,
      number: suggestions.number,
      note: suggestions.note,
      slug: templates.slug,
      items: sql<number>`jsonb_array_length(${suggestions.items})`,
      authorHandle: users.handle,
      createdAt: suggestions.createdAt,
    })
    .from(suggestions)
    .innerJoin(templates, eq(templates.id, suggestions.templateId))
    .innerJoin(users, eq(users.id, suggestions.authorId))
    .where(and(eq(templates.ownerId, userId), eq(suggestions.status, 'open')))
    .orderBy(suggestions.createdAt)
    .limit(Math.min(50, Math.max(1, limit)))
  return {
    pending: rows.length,
    suggestions: rows.map((r) => ({ id: r.id, list: r.slug, number: r.number, note: r.note, items: r.items, author: r.authorHandle, at: r.createdAt })),
  }
}

/**
 * РЕГИСТРАЦИЯ ИСТОЧНИКА — единственная дверь, через которую чужой материал попадает в корпус.
 *
 * Лицензию называет ЧЕЛОВЕК, а не угадывает алгоритм по домену: доступность страницы в
 * интернете не означает права копировать. Проверка fail-closed — невнятная лицензия равна
 * запрету, потому что материал возьмут один раз, а отвечать за него придётся всё время, пока
 * он лежит в библиотеке.
 *
 * Повторная регистрация того же адреса ОБНОВЛЯЕТ запись, а не плодит вторую с другой
 * лицензией: иначе вопрос «какая из них настоящая» решать нечем.
 */
export async function mcpRegisterSource(
  userId: string,
  input: { url: string; title?: string; license: string; attribution?: string; note?: string },
) {
  // Реестр источников ОБЩИЙ для компании: по нему решают, что можно брать в корпус.
  // Обычный write-токен сюда пускать нельзя — любой вошедший мог бы объявить чужой
  // материал свободным или переписать лицензию у уже проверенного источника.
  // Юридический вердикт даёт человек, отвечающий за него, а не всякий, у кого есть токен.
  const [me] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  if (!isAdminHandle(me?.handle ?? null)) {
    return { error: 'only an administrator can register sources — the license verdict is a legal decision' }
  }
  const url = (input.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) return { error: 'url must be an http(s) address' }
  const verdict = checkLicense(input.license ?? '', input.attribution ?? '')
  if (!verdict.ok || !verdict.license) return { error: `нельзя брать: ${verdict.reason}` }

  const [row] = await db
    .insert(knowledgeSources)
    .values({
      url,
      title: (input.title ?? '').trim().slice(0, 200),
      license: verdict.license,
      attribution: (input.attribution ?? '').trim().slice(0, 200),
      note: (input.note ?? '').trim().slice(0, 500),
      addedBy: userId,
    })
    .onConflictDoUpdate({
      target: knowledgeSources.url,
      set: {
        title: (input.title ?? '').trim().slice(0, 200),
        license: verdict.license,
        attribution: (input.attribution ?? '').trim().slice(0, 200),
        note: (input.note ?? '').trim().slice(0, 500),
      },
    })
    .returning({ id: knowledgeSources.id, license: knowledgeSources.license })

  await recordAgentAction({
    loop: 'mcp',
    action: 'source.register',
    resultStatus: 'ok',
    actorUserId: userId,
    principalMode: 'on_behalf_of',
    signal: { url },
    decision: { license: row.license, requiresAttribution: !!(input.attribution ?? '').trim() },
    resultRef: url.slice(0, 300),
  })
  return {
    id: row.id,
    license: row.license,
    attribution: attributionLine(verdict.license, input.attribution ?? '', url),
    note: verdict.reason,
  }
}

/** Зарегистрированные источники — что вообще разрешено цитировать и копировать. */
export async function mcpListSources(limit = 50) {
  const rows = await db
    .select({ url: knowledgeSources.url, title: knowledgeSources.title, license: knowledgeSources.license, attribution: knowledgeSources.attribution, note: knowledgeSources.note })
    .from(knowledgeSources)
    .orderBy(desc(knowledgeSources.createdAt))
    .limit(Math.min(200, Math.max(1, limit)))
  return { sources: rows.length, allowed: rows }
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

  // Архив/заморозка: гейт нужен ЗДЕСЬ, а не только в фасадном бэкстопе addVersion —
  // мета (tags/ordered) обновляется до версии и не должна утечь в read-only список.
  if (!canEditList(tpl)) return { error: 'forbidden: list is archived or frozen' }

  if (tpl.status === 'draft') {
    // черновик — перезаписываем текущую версию на месте (без плодения версий)
    const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
    await db.delete(steps).where(eq(steps.versionId, cur.id))
    await insertSteps(cur.id, proposed)
    await db.update(templates).set({ tags, ordered: input.ordered ?? tpl.ordered, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
    return { ref: `${handle}/${slug}`, status: 'draft', version: cur.version }
  }

  // tags/ordered едут ВНУТРИ addVersion (Ф2a-довесок): ядро применяет мету той же
  // транзакцией, что и версию, — канон коммита сразу несёт свежие значения.
  const ver = await listStore.addVersion(tpl.id, {
    note: input.note?.trim() || 'updated via API',
    steps: stepInput(proposed),
    meta: { tags, ordered: input.ordered ?? tpl.ordered },
  })
  // Пере-проверку публичного списка делает фасад listStore.addVersion (барьер): нарушающий
  // контент, залитый через MCP, не минует модерацию, и здесь её дублировать не нужно.
  const { enqueueReindex } = await import('@/features/library/jobs')
  await enqueueReindex(tpl.id)
  return { ref: `${handle}/${slug}`, status: 'published', version: ver.version }
}

// ── Прогоны (runs): запуск/просмотр/отметка шагов через MCP ──────────
// Логика зеркалит features/runs, но принимает userId из токена (не session).

/** Состояние прогона: список шагов с отметками + прогресс. */
async function mcpRunState(userId: string, runId: string) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== userId) return { error: 'run not found' }
  // Только шаг-блоки, перенумерованные 1..K (индекс среди шагов) — это и есть N
  // для check_step. text/image в прогон не входят. Три независимых чтения — параллельно.
  const [[meta], stepRows, states] = await Promise.all([
    db
      .select({ slug: templates.slug, ownerHandle: users.handle })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .where(eq(templates.id, run.templateId))
      .limit(1),
    db.select({ id: steps.id, title: steps.title }).from(steps).where(and(eq(steps.versionId, run.versionId), eq(steps.type, 'step'))).orderBy(steps.n),
    db.select({ stepId: runStepState.stepId, status: runStepState.status, note: runStepState.note }).from(runStepState).where(eq(runStepState.runId, runId)),
  ])
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
  const completion = await getCourseCompletion(run.templateId, userId)
  return {
    runId,
    ref: meta ? `${meta.ownerHandle}/${meta.slug}` : undefined,
    version: run.version,
    status: run.status,
    progress: { done: stepsOut.filter((s) => s.done).length, total: stepsOut.length },
    // Курс пройден (веха): все шаги отмечены (или пройдены все тесты списка).
    courseCompleted: !!completion,
    steps: stepsOut,
  }
}

/** Запустить (или продолжить активный) прогон списка по текущей версии. */
export async function mcpStartRun(userId: string, handle: string, slug: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return { error: 'list not found' }
  const { tpl, currentVersion } = detail
  if (!(await mcpCanView(tpl, userId))) return { error: 'forbidden' }
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
  // Все шаги отмечены → фиксируем прохождение курса (та же веха, что на сайте).
  await recordRunCompletionIfDone(userId, run)
  return mcpRunState(userId, runId)
}
