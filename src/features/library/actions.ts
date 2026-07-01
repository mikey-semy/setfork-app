'use server'

import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db, steps, templateVersions, templates, topics, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

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
 * Минимальное создание шаблона (v0): заголовок, описание, тема и шаги
 * (по строке на шаг). Заголовки шагов пишутся в оба языковых поля —
 * полноценный двуязычный редактор откладываем.
 */
export async function createTemplate(formData: FormData): Promise<void> {
  const session = await requireSession()
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
      titleEn: title,
      titleRu: title,
      descEn: desc,
      descRu: desc,
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
      lines.map((line, i) => ({
        versionId: ver.id,
        n: i + 1,
        titleEn: line,
        titleRu: line,
      })),
    )
  }

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, session.userId))
  redirect(`/${owner.handle}/${slug}`)
}
