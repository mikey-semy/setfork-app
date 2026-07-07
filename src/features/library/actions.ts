'use server'

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { recordAudit } from '@/shared/audit'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { imageUrl, uploadImageFile, uploadVideoFile } from '@/shared/media'
import { generateChangeNote, generateListRefine } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { aiQuota, listQuota } from '@/shared/quota'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { enqueueReindex } from '@/features/search/adapter'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { curationStore } from '@/features/curation/store'
import { collabStore, suggestionCommenterIds } from '@/features/collab-store/store'
import { autoModerateList } from '@/features/moderation/moderate-list'
import { parseEditorItems, toProposedItems, type EditorItem } from './editor'
import { listStore } from './list-store'
import { parseTags, slugify } from './slug'
import { canViewList } from './access'

/** ProposedItem[] → доменный вход шагов для ListStore.addVersion. */
function toStepInput(items: ProposedItem[]) {
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

// ── Видимость списка (public/private) и удаление ─────────────────────
export async function setListVisibility(templateId: string, visibility: 'public' | 'private'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  if (visibility === 'private') {
    // приватному модерация не нужна — сбрасываем статус
    await db.update(templates).set({ visibility, moderation: 'active', moderationReason: null }).where(eq(templates.id, templateId))
  } else {
    await db.update(templates).set({ visibility }).where(eq(templates.id, templateId))
    await autoModerateList(templateId) // публикация → проверяем
  }
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath('/explore')
}

/** «Customize your pins»: закрепить ровно выбранный набор своих списков (кап 6). */
export async function updatePins(templateIds: string[]): Promise<void> {
  const session = await requireSession()
  const ids = templateIds.slice(0, 6)
  // Сначала снимаем все свои пины, затем ставим выбранные — итог точно равен выбору.
  await db.update(templates).set({ pinned: false }).where(eq(templates.ownerId, session.userId))
  if (ids.length) {
    await db
      .update(templates)
      .set({ pinned: true })
      .where(and(eq(templates.ownerId, session.userId), inArray(templates.id, ids)))
  }
  revalidatePath(`/${session.handle}`)
}

export async function setListPinned(templateId: string, pinned: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ pinned }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function deleteListAction(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.delete(templates).where(eq(templates.id, templateId)) // каскад: версии/шаги/звёзды/предложения
  await recordAudit('list.delete', { actorId: session.userId, targetType: 'list', targetId: templateId, meta: { slug: tpl.slug } })
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}`)
}

// ── Загрузка скриншота шага (в редакторе) ────────────────────────────
export async function uploadStepImage(formData: FormData): Promise<{ key: string; url: string } | { error: string }> {
  const session = await requireSession()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Файл не выбран.' }
  try {
    const key = await uploadImageFile(`steps/${session.userId}`, file)
    return { key, url: (await imageUrl(key, 'rs:fit:960:960')) ?? '' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не удалось загрузить.' }
  }
}

/** Загрузка своего видео-файла (video-блок) → путь /uploads/videos/... для <video>. */
export async function uploadStepVideo(formData: FormData): Promise<{ url: string } | { error: string }> {
  const session = await requireSession()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Файл не выбран.' }
  try {
    const url = await uploadVideoFile(`videos/${session.userId}`, file)
    return { url }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не удалось загрузить.' }
  }
}

async function notifyWatchersNewVersion(templateId: string, actorId: string): Promise<void> {
  const watchers = await getWatcherIds(templateId)
  await notifyMany(watchers, { actorId, type: 'new_version', templateId })
}

async function ownerHandle(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return u.handle
}

// ── Создание списка ───────────────────────────────────────────────────
export async function createTemplate(formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const title = String(formData.get('title') ?? '').trim()
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const visibility = formData.get('visibility') === 'private' ? 'private' : 'public'
  const ordered = formData.get('ordered') !== 'unordered'
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)
  if (!title) return
  // Квота на число списков (мягкая защита от абьюза; админ без лимита).
  if (!(await listQuota(session.userId, session.handle)).ok) redirect('/new?e=list_quota')

  let slug = slugify(title)
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
  if (owned.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

  const list = await listStore.create({
    ownerId: session.userId,
    slug,
    title: { [lang]: title },
    desc: desc ? { [lang]: desc } : {},
    tags,
    ordered,
    visibility,
    status: 'published',
    origin: 'authored',
    note: 'initial',
    steps: toStepInput(proposed),
  })
  await ensureWatch(session.userId, list.id) // владелец следит за своим списком
  if (visibility === 'public') await autoModerateList(list.id) // приватные не модерируем
  await enqueueReindex(list.id) // авто-индексация в поиск (через очередь)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

// ── Владелец: сохранить как новую версию ─────────────────────────────
export async function saveNewVersion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  const note = String(formData.get('note') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const ordered = formData.get('ordered') !== 'unordered'
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  // Создание версии+шагов идёт через доменный порт ListStore (write-seam под Rust).
  await listStore.addVersion(tpl.id, { note: note || 'edit', steps: toStepInput(proposed) })
  // tags/ordered — атрибуты списка, не версии; обновляем отдельно.
  await db.update(templates).set({ tags, ordered, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  if (tpl.visibility === 'public') await autoModerateList(tpl.id) // новая версия могла внести нарушающий контент
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Предложить правку (PR) ────────────────────────────────────────────
export async function submitSuggestion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  // Нельзя предлагать правки к приватному/скрытому списку, которого не видишь
  // (иначе — запись в чужую очередь + пинг владельцу + оракул существования).
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return

  const note = String(formData.get('note') ?? '').trim()
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  const created = await collabStore.createSuggestion(tpl.id, session.userId, note, toStepInput(proposed))
  await ensureWatch(session.userId, tpl.id) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  await notifyMentions({ text: note, actorId: session.userId, templateId: tpl.id })

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/suggestions`)
}

// ── A3: PR из ветки («ветка → main») ─────────────────────────────────
export async function openBranchPr(templateId: string, branch: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  // Ветки пушит только владелец/коллаборатор → и PR из ветки открывают они же
  // (push-концепт). Заодно закрывает открытие PR на чужом приватном списке.
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  const { gitCore } = await import('@/features/git/core')
  const owner = await ownerHandle(tpl.ownerId)
  // Ветка должна существовать и содержать list.json (иначе PR не из чего собрать).
  const snap = await gitCore.branchSnapshot({ owner, slug: tpl.slug }, branch).catch(() => null)
  if (!snap) redirect(`/${owner}/${tpl.slug}`)
  // Один открытый PR на ветку: повторное «Open PR» ведёт на существующий.
  const dup = await db.query.suggestions.findFirst({
    where: (s) => and(eq(s.templateId, tpl.id), eq(s.branchRef, branch), eq(s.status, 'open')),
  })
  if (dup) redirect(`/${owner}/${tpl.slug}/suggestions/${dup.id}`)

  const [created] = await db
    .insert(suggestions)
    .values({
      templateId: tpl.id,
      authorId: session.userId,
      note: `Merge branch '${branch}'`,
      baseVersion: tpl.currentVersion,
      items: [], // источник правды — tip ветки, материализуется при просмотре
      branchRef: branch,
    })
    .returning({ id: suggestions.id })
  await ensureWatch(session.userId, tpl.id)
  if (tpl.ownerId !== session.userId) {
    await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  }
  redirect(`/${owner}/${tpl.slug}/suggestions/${created.id}`)
}

/** Владелец/коллаборатор: влить branch-PR (ff или merge-commit + проекция). */
export async function mergeBranchPr(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || !sug.branchRef) return
  const tpl = sug.template
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.id}`
  const { gitCore } = await import('@/features/git/core')
  const { BranchOpError } = await import('@/core')
  try {
    await gitCore.mergeBranch({ owner, slug: tpl.slug }, sug.branchRef)
  } catch (e) {
    const code = e instanceof BranchOpError ? e.code : 'internal'
    redirect(`${path}?e=${code}`)
  }
  await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, sug.id))
  if (sug.authorId !== session.userId) {
    await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  }
  if (tpl.visibility === 'public') await autoModerateList(tpl.id) // merge мог внести нарушающий контент
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)
  revalidatePath('/', 'layout')
  redirect(`/${owner}/${tpl.slug}`)
}

/** A4: merge branch-PR c ручным разрешением конфликтов по шагам.
 *  Сервер пересчитывает three-way детерминированно и применяет выбор —
 *  клиентскому результату не доверяем. */
export async function resolveBranchPr(suggestionId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || !sug.branchRef) return
  const tpl = sug.template
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.id}`

  const isChoice = (v: unknown): v is 'ours' | 'theirs' => v === 'ours' || v === 'theirs'
  let stepChoices: Record<string, 'ours' | 'theirs'> = {}
  let metaChoices: Record<string, 'ours' | 'theirs'> = {}
  try {
    const sc = JSON.parse(String(formData.get('stepChoices') ?? '{}')) as Record<string, unknown>
    const mc = JSON.parse(String(formData.get('metaChoices') ?? '{}')) as Record<string, unknown>
    stepChoices = Object.fromEntries(Object.entries(sc).filter(([, v]) => isChoice(v))) as typeof stepChoices
    metaChoices = Object.fromEntries(Object.entries(mc).filter(([, v]) => isChoice(v))) as typeof metaChoices
  } catch {
    redirect(`${path}?e=unresolved`)
  }

  const { gitCore } = await import('@/features/git/core')
  const { threeWayMerge, applyChoices } = await import('@/features/git/three-way')
  const { BranchOpError } = await import('@/core')

  const state = await gitCore.mergeState({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
  if (!state) redirect(`${path}?e=not-found`)
  const res = threeWayMerge(state.base, state.ours, state.theirs)
  const final = applyChoices(res, stepChoices, metaChoices)
  if (!final) redirect(`${path}?e=unresolved`) // выбраны не все конфликты (или state изменился)

  // Каноничный формат list.json — как versionFiles (serialize.ts).
  const listJson =
    JSON.stringify(
      {
        title: final.title,
        desc: final.desc,
        tags: final.tags,
        ordered: final.ordered,
        version: tpl.currentVersion + 1,
        steps: final.steps.map((s, i) => ({ n: i + 1, ...s })),
      },
      null,
      2,
    ) + '\n'

  try {
    await gitCore.mergeResolved({ owner, slug: tpl.slug }, sug.branchRef, listJson)
  } catch (e) {
    const code = e instanceof BranchOpError ? e.code : 'internal'
    redirect(`${path}?e=${code}`)
  }
  await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, sug.id))
  if (sug.authorId !== session.userId) {
    await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  }
  if (tpl.visibility === 'public') await autoModerateList(tpl.id) // merge мог внести нарушающий контент
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)
  revalidatePath('/', 'layout')
  redirect(`/${owner}/${tpl.slug}`)
}

// ── Автор списка: принять предложение → новая версия ─────────────────
export async function acceptSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || sug.template.ownerId !== session.userId) return

  const tpl = sug.template
  // Новая версия из принятого предложения — через доменный порт.
  await listStore.addVersion(tpl.id, { note: sug.note || 'suggested edit', steps: toStepInput(sug.items) })
  if (tpl.visibility === 'public') await autoModerateList(tpl.id) // принятая правка могла внести нарушающий контент
  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Обсуждение предложения (review-комментарии) ──────────────────────
export async function addSuggestionComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const suggestionId = String(formData.get('suggestionId') ?? '')
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug) return
  const handle = await ownerHandle(sug.template.ownerId)
  const path = `/${handle}/${sug.template.slug}/suggestions/${sug.id}`
  if (!body) redirect(path)

  await collabStore.addSuggestionComment(sug.id, session.userId, body)
  await ensureWatch(session.userId, sug.templateId)

  const commenters = await suggestionCommenterIds(sug.id)
  const watchers = await getWatcherIds(sug.templateId)
  const recipients = [sug.authorId, sug.template.ownerId, ...commenters, ...watchers]
  await notifyMany(recipients, { actorId: session.userId, type: 'suggestion_comment', templateId: sug.templateId, suggestionId: sug.id })
  await notifyMentions({ text: body, actorId: session.userId, templateId: sug.templateId })

  revalidatePath(path)
  redirect(path)
}

// ── Автор списка: отклонить предложение ──────────────────────────────
export async function rejectSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || sug.template.ownerId !== session.userId) return

  await db
    .update(suggestions)
    .set({ status: 'rejected', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_rejected', templateId: sug.templateId, suggestionId: sug.id })
  revalidatePath('/', 'layout')
}

// ── AI-refine: правка пунктов редактора по инструкции ────────────────
export async function refineList(input: {
  items: EditorItem[]
  title: string
  desc: string
  tags: string[]
  instruction: string
}): Promise<{ items: EditorItem[] } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const instruction = String(input.instruction ?? '').trim()
  if (!instruction) return { error: 'empty' }

  const { allowed } = checkRateLimit(`refine:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const current = {
    title: input.title || '',
    desc: input.desc || '',
    tags: input.tags || [],
    items: (input.items || [])
      .filter((it) => it.title?.trim())
      .map((it) => ({
        title: it.title,
        desc: it.desc,
        command: it.command,
        level: it.level ?? 'required',
        why: it.why ?? '',
        subtasks: (it.subtasks || []).filter((s) => s.trim()),
        refs: (it.refs || []).filter((r) => r.label?.trim() && r.url?.trim()).map((r) => ({ label: r.label, url: r.url })),
      })),
  }
  const refined = await generateListRefine(current, instruction, lang, { userId: session.userId, feature: 'refine' })
  if (!refined) return { error: 'aifail' }

  // Refine переписывает текстовое содержимое шагов; скриншоты не переносятся, ссылки — да.
  const items: EditorItem[] = refined.items.map((it) => ({
    type: 'step' as const,
    bid: '',
    text: '',
    caption: '',
    videoUrl: '',
    poll: { question: '', options: [], multi: false, deadline: '' },
    quiz: { kind: 'choice' as const, question: '', options: [], multi: false, accept: [], caseSensitive: false, answer: '', tolerance: '', template: '', blanks: [], explain: '' },
    title: it.title,
    desc: it.desc,
    command: it.command,
    imageKey: '',
    imagePreview: '',
    level: it.level,
    why: it.why,
    section: '',
    subtasks: it.subtasks,
    refs: (it.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
  }))
  return { items }
}

// ── AI: примечание к версии из диффа (What changed & why) ────────────
export async function generateChangeNoteAction(
  templateId: string,
  itemsJson: string,
): Promise<{ note: string } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl || tpl.ownerId !== session.userId) return { error: 'forbidden' }

  const { allowed } = checkRateLimit(`note:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const baseSteps = cur
    ? await db.select().from(steps).where(eq(steps.versionId, cur.id)).orderBy(asc(steps.n))
    : []
  const base = baseSteps.map((s) => ({
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    subtasks: s.subtasks.map((x) => tr(x, lang)),
  }))
  const next = parseEditorItems(itemsJson)
    .filter((it) => it.title.trim())
    .map((it) => ({ title: it.title, desc: it.desc, command: it.command, subtasks: it.subtasks.filter((s) => s.trim()) }))

  const note = await generateChangeNote(base, next, lang, { userId: session.userId, refType: 'template', refId: tpl.id })
  if (!note) return { error: 'aifail' }
  return { note }
}

// ── Публикация черновика (draft → published) ─────────────────────────
export async function publishList(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId || tpl.status !== 'draft') return

  await db.update(templates).set({ status: 'published', updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  // Публикуем публичный список → авто-модерация (приватный не трогаем).
  if (tpl.visibility === 'public') await autoModerateList(tpl.id)

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Star (сигнал качества + личная коллекция) ────────────────────────
export async function toggleStar(templateId: string): Promise<void> {
  const session = await requireSession()
  // Видимость проверяем ДО тоггла: нельзя звездить (и пинговать владельца)
  // приватный/скрытый список, которого не видишь.
  const [t] = await db
    .select({ ownerId: templates.ownerId, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!t || !canViewList(t, { isOwner: t.ownerId === session.userId })) return
  const nowStarred = await curationStore.toggleStar(templateId, session.userId)
  if (nowStarred) await notify({ recipientId: t.ownerId, actorId: session.userId, type: 'star', templateId })
  revalidatePath('/', 'layout')
}

// ── Форк ──────────────────────────────────────────────────────────────
// ── «Use this template»: копия списка БЕЗ fork-связи ─────────────────
export async function setListTemplate(templateId: string, isTemplate: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ isTemplate }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

/** Создать свой список на основе шаблона: копия текущей версии, origin
 *  authored, без forked_from (в этом отличие от форка). */
export async function useTemplate(templateId: string): Promise<void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  // Только помеченные шаблоном и видимые (публичные или свои).
  if (!src || !src.isTemplate) return
  if (src.visibility === 'private' && src.ownerId !== session.userId) return
  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/${session.handle}?e=list_quota`)

  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, src.slug)))
  const slug = owned.length ? `${src.slug}-copy` : src.slug

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const srcSteps = srcCurrent
    ? await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    : []
  await listStore.create({
    ownerId: session.userId,
    slug,
    title: src.title,
    desc: src.desc,
    tags: src.tags,
    ordered: src.ordered,
    visibility: 'public',
    status: 'published',
    origin: 'authored', // шаблон — стартовая точка, не fork-связь
    forkedFromId: null,
    note: `from template ${src.slug}`,
    steps: srcSteps.map((s, i) => ({
      n: i + 1,
      type: s.type ?? 'step', // блочная модель: копия не должна терять text/image блоки
      content: s.content ?? {},
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      imageRef: s.imageKey ?? null,
    })),
  })
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}/${slug}`)
}

export async function forkTemplate(templateId: string): Promise<void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!src) return
  // Видимость: форк раскрывает ВСЁ содержимое списка (шаги/команды) — приватные
  // и скрытые модерацией доступны только владельцу (как в useTemplate). Иначе
  // любой залогиненный мог бы склонировать чужой приватный список по его id.
  if (!canViewList(src, { isOwner: src.ownerId === session.userId })) return

  // Дедуп: этот пользователь уже форкал этот список → ведём на существующий форк,
  // не плодим дубли (двойной клик по кнопке Fork создавал два форка + двойной счётчик).
  const [existingFork] = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.forkedFromId, src.id)))
    .limit(1)
  if (existingFork) redirect(`/${session.handle}/${existingFork.slug}`)

  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/${session.handle}?e=list_quota`)

  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, src.slug)))
  const slug = owned.length ? `${src.slug}-fork` : src.slug

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const srcSteps = srcCurrent
    ? await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    : []
  const forked = await listStore.create({
    ownerId: session.userId,
    slug,
    title: src.title,
    desc: src.desc,
    tags: src.tags,
    ordered: src.ordered,
    visibility: src.visibility,
    status: 'published',
    origin: 'forked',
    forkedFromId: src.id,
    note: `forked from ${src.slug} v${srcCurrent?.version ?? 1}`,
    steps: srcSteps.map((s, i) => ({
      n: i + 1,
      type: s.type ?? 'step', // блочная модель: копия не должна терять text/image блоки
      content: s.content ?? {},
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      imageRef: s.imageKey ?? null,
    })),
  })

  await db
    .update(templates)
    .set({ forksCount: sql`${templates.forksCount} + 1` })
    .where(eq(templates.id, src.id))
  await notify({ recipientId: src.ownerId, actorId: session.userId, type: 'fork', templateId: src.id })
  await enqueueReindex(forked.id)

  revalidatePath('/explore')
  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}
