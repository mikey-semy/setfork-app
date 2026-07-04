'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { imageUrl, uploadImageFile } from '@/shared/media'
import { generateChangeNote, generateListRefine } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { enqueueReindex } from '@/features/search/adapter'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { curationStore } from '@/features/curation/adapter'
import { collabStore, suggestionCommenterIds } from '@/features/collab-store/adapter'
import { autoModerateList } from '@/features/moderation/moderate-list'
import { parseEditorItems, toProposedItems, type EditorItem } from './editor'
import { listStore } from './list-store.adapter'
import { parseTags, slugify } from './slug'

/** ProposedItem[] → доменный вход шагов для ListStore.addVersion. */
function toStepInput(items: ProposedItem[]) {
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

  const note = String(formData.get('note') ?? '').trim()
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  await collabStore.createSuggestion(tpl.id, session.userId, note, toStepInput(proposed))
  await ensureWatch(session.userId, tpl.id) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id })
  await notifyMentions({ text: note, actorId: session.userId, templateId: tpl.id })

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/suggestions`)
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
  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id })
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
  await notifyMany(recipients, { actorId: session.userId, type: 'suggestion_comment', templateId: sug.templateId })
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
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_rejected', templateId: sug.templateId })
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
  const nowStarred = await curationStore.toggleStar(templateId, session.userId)
  if (nowStarred) {
    const [t] = await db.select({ ownerId: templates.ownerId }).from(templates).where(eq(templates.id, templateId))
    if (t) await notify({ recipientId: t.ownerId, actorId: session.userId, type: 'star', templateId })
  }
  revalidatePath('/', 'layout')
}

// ── Форк ──────────────────────────────────────────────────────────────
export async function forkTemplate(templateId: string): Promise<void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!src) return

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
