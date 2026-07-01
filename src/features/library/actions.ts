'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, stars, steps, templateVersions, templates, topics, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'

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

/**
 * Минимальное создание списка (v0): заголовок, описание, тема и пункты
 * (по строке на пункт). Заголовки пунктов пишутся в оба языковых поля —
 * полноценный двуязычный редактор откладываем.
 */
export async function createTemplate(formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const title = String(formData.get('title') ?? '').trim()
  const desc = String(formData.get('desc') ?? '').trim()
  const topicSlug = String(formData.get('topic') ?? '').trim()
  const stepsRaw = String(formData.get('steps') ?? '')
  if (!title) return

  let slug = slugify(title)
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
  if (owned.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

  let topicId: string | null = null
  if (topicSlug) {
    const [tp] = await db.select({ id: topics.id }).from(topics).where(eq(topics.slug, topicSlug)).limit(1)
    topicId = tp?.id ?? null
  }

  const [tpl] = await db
    .insert(templates)
    .values({
      ownerId: session.userId,
      slug,
      title: { [lang]: title },
      desc: desc ? { [lang]: desc } : {},
      topicId,
      currentVersion: 1,
      origin: 'authored',
    })
    .returning()

  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: 1, note: 'initial' })
    .returning()

  const lines = stepsRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length) {
    await db.insert(steps).values(
      lines.map((line, i) => ({ versionId: ver.id, n: i + 1, title: { [lang]: line } })),
    )
  }

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, session.userId))
  redirect(`/${owner.handle}/${slug}`)
}

// ── Лайк (сигнал эталонности) ─────────────────────────────────────────
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

// ── Форк списка в пространство пользователя (улучшенная/альтернативная версия) ──
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
      topicId: src.topicId,
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
    const srcSteps = await db
      .select()
      .from(steps)
      .where(eq(steps.versionId, srcCurrent.id))
      .orderBy(asc(steps.n))
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

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, session.userId))
  revalidatePath('/explore')
  redirect(`/${owner.handle}/${slug}`)
}
