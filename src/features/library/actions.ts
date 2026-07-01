'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  db,
  stars,
  steps,
  suggestions,
  templateVersions,
  templates,
  users,
  type ProposedItem,
} from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { parseEditorItems, toProposedItems } from './editor'

function parseTags(raw: unknown): string[] {
  return [
    ...new Set(
      String(raw ?? '')
        .toLowerCase()
        .split(/[\s,]+/)
        .map((tag) => tag.replace(/[^a-z0-9а-яё-]/gi, '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 8)
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'list'
  )
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
      hasImage: it.hasImage,
      subtasks: it.subtasks,
      refs: it.refs,
    })),
  )
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
    })
    .returning()

  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: 1, note: 'initial' })
    .returning()
  await insertSteps(ver.id, proposed)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

// ── Владелец: сохранить как новую версию ─────────────────────────────
export async function saveNewVersion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return

  const note = String(formData.get('note') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)
  const newVersion = tpl.currentVersion + 1

  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: newVersion, note: note || 'edit' })
    .returning()
  await insertSteps(ver.id, proposed)
  await db
    .update(templates)
    .set({ currentVersion: newVersion, tags, updatedAt: new Date() })
    .where(eq(templates.id, tpl.id))

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

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
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
  revalidatePath('/', 'layout')
}

// ── Лайк ──────────────────────────────────────────────────────────────
export async function toggleLike(templateId: string): Promise<void> {
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

  revalidatePath('/explore')
  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}
