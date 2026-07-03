'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  db,
  stars,
  steps,
  suggestionComments,
  suggestions,
  templateVersions,
  templates,
  users,
  type ProposedItem,
} from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { imageUrl, uploadImageFile } from '@/shared/media'
import { generateChangeNote, generateListRefine } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { notify, notifyMany } from '@/features/notifications/notify'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { autoModerateList } from '@/features/moderation/moderate-list'
import { parseEditorItems, toProposedItems, type EditorItem } from './editor'
import { listStore } from './list-store.adapter'
import { parseTags, slugify } from './slug'

async function insertSteps(versionId: string, items: ProposedItem[]): Promise<void> {
  if (!items.length) return
  await db.insert(steps).values(
    items.map((it, i) => ({
      versionId,
      n: i + 1,
      title: it.title,
      desc: it.desc,
      command: it.command,
      hasImage: it.hasImage,
      imageKey: it.imageKey ?? null,
      level: it.level,
      why: it.why,
      section: it.section,
      subtasks: it.subtasks,
      refs: it.refs,
    })),
  )
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

  const [tpl] = await db
    .insert(templates)
    .values({
      ownerId: session.userId,
      slug,
      title: { [lang]: title },
      desc: desc ? { [lang]: desc } : {},
      tags,
      currentVersion: 1,
      origin: 'authored',
      visibility,
      ordered,
    })
    .returning()

  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: 1, note: 'initial' })
    .returning()
  await insertSteps(ver.id, proposed)
  await ensureWatch(session.userId, tpl.id) // владелец следит за своим списком
  if (visibility === 'public') await autoModerateList(tpl.id) // приватные не модерируем

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
  await listStore.addVersion(tpl.id, {
    note: note || 'edit',
    steps: proposed.map((it, i) => ({
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
    })),
  })
  // tags/ordered — атрибуты списка, не версии; обновляем отдельно.
  await db.update(templates).set({ tags, ordered, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  await notifyWatchersNewVersion(tpl.id, session.userId)

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

  await db.insert(suggestions).values({
    templateId: tpl.id,
    authorId: session.userId,
    note,
    baseVersion: tpl.currentVersion,
    items: proposed,
  })
  await ensureWatch(session.userId, tpl.id) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id })

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
  const newVersion = tpl.currentVersion + 1
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: newVersion, note: sug.note || 'suggested edit' })
    .returning()
  await insertSteps(ver.id, sug.items)
  await db
    .update(templates)
    .set({ currentVersion: newVersion, updatedAt: new Date() })
    .where(eq(templates.id, tpl.id))
  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id })
  await notifyWatchersNewVersion(tpl.id, session.userId)

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

  await db.insert(suggestionComments).values({ suggestionId: sug.id, authorId: session.userId, body })
  await ensureWatch(session.userId, sug.templateId)

  const commenters = await db
    .selectDistinct({ id: suggestionComments.authorId })
    .from(suggestionComments)
    .where(eq(suggestionComments.suggestionId, sug.id))
  const watchers = await getWatcherIds(sug.templateId)
  const recipients = [sug.authorId, sug.template.ownerId, ...commenters.map((c) => c.id), ...watchers]
  await notifyMany(recipients, { actorId: session.userId, type: 'suggestion_comment', templateId: sug.templateId })

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
      })),
  }
  const refined = await generateListRefine(current, instruction, lang, { userId: session.userId, feature: 'refine' })
  if (!refined) return { error: 'aifail' }

  // Refine переписывает текстовое содержимое шагов; скриншоты/ссылки не переносятся.
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
    refs: [],
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
  const existing = await db
    .select({ id: stars.id })
    .from(stars)
    .where(and(eq(stars.userId, session.userId), eq(stars.templateId, templateId)))
    .limit(1)

  if (existing.length) {
    await db.delete(stars).where(and(eq(stars.userId, session.userId), eq(stars.templateId, templateId)))
    await db
      .update(templates)
      .set({ starsCount: sql`GREATEST(${templates.starsCount} - 1, 0)` })
      .where(eq(templates.id, templateId))
  } else {
    await db.insert(stars).values({ userId: session.userId, templateId })
    await db
      .update(templates)
      .set({ starsCount: sql`${templates.starsCount} + 1` })
      .where(eq(templates.id, templateId))
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

  const [fork] = await db
    .insert(templates)
    .values({
      ownerId: session.userId,
      slug,
      title: src.title,
      desc: src.desc,
      tags: src.tags,
      currentVersion: 1,
      origin: 'forked',
      visibility: src.visibility,
      ordered: src.ordered,
      forkedFromId: src.id,
    })
    .returning()

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: fork.id, version: 1, note: `forked from ${src.slug} v${srcCurrent?.version ?? 1}` })
    .returning()

  if (srcCurrent) {
    const srcSteps = await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    if (srcSteps.length) {
      await db.insert(steps).values(
        srcSteps.map((s) => ({
          versionId: ver.id,
          n: s.n,
          title: s.title,
          desc: s.desc,
          command: s.command,
          hasImage: s.hasImage,
          imageKey: s.imageKey,
          level: s.level,
          why: s.why,
          section: s.section,
          subtasks: s.subtasks,
          refs: s.refs,
        })),
      )
    }
  }

  await db
    .update(templates)
    .set({ forksCount: sql`${templates.forksCount} + 1` })
    .where(eq(templates.id, src.id))
  await notify({ recipientId: src.ownerId, actorId: session.userId, type: 'fork', templateId: src.id })

  revalidatePath('/explore')
  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}
