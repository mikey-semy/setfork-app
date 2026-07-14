'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { db, tags } from '@/shared/db'
import { requireAdmin } from '@/shared/auth/admin'
import { recomputeTagUsage, removeTagFromTemplates, replaceTagInTemplates } from './service'

// Курируемый реестр тегов — админ-CRUD (переименование/слияние/удаление/курирование).
// templates.tags (text[]) правится синхронно; usage_count пересчитывается.

type Res = { ok: true } | { error: string }

/** Нормализация тега — те же правила, что parseTags (lowercase, a-z0-9а-яё-). */
function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]/gi, '')
    .slice(0, 40)
}

function revalidateTags() {
  revalidatePath('/admin/tags')
  revalidatePath('/tags')
}

/** Переименовать тег: slug from→to во всех списках и в реестре. Если to уже есть — сливаем. */
export async function renameTag(fromRaw: string, toRaw: string): Promise<Res> {
  await requireAdmin()
  const from = normalizeTag(fromRaw)
  const to = normalizeTag(toRaw)
  if (!from || !to) return { error: 'Пустой тег.' }
  if (from === to) return { ok: true }
  const [exists] = await db.select({ slug: tags.slug }).from(tags).where(eq(tags.slug, from))
  if (!exists) return { error: 'Тег не найден.' }

  await replaceTagInTemplates(from, to)
  // Переносим метаданные: to не трогаем если уже есть (это слияние); иначе создаём с меткой from.
  const [fromRow] = await db.select().from(tags).where(eq(tags.slug, from))
  await db
    .insert(tags)
    .values({ slug: to, label: fromRow?.label ?? null, description: fromRow?.description ?? null, curated: fromRow?.curated ?? false })
    .onConflictDoNothing()
  await db.delete(tags).where(eq(tags.slug, from))
  await recomputeTagUsage([from, to])
  revalidateTags()
  return { ok: true }
}

/** Слить тег from в into (into остаётся, from удаляется). */
export async function mergeTags(fromRaw: string, intoRaw: string): Promise<Res> {
  await requireAdmin()
  const from = normalizeTag(fromRaw)
  const into = normalizeTag(intoRaw)
  if (!from || !into) return { error: 'Пустой тег.' }
  if (from === into) return { error: 'Совпадающие теги.' }
  await replaceTagInTemplates(from, into)
  await db.insert(tags).values({ slug: into }).onConflictDoNothing()
  await db.delete(tags).where(eq(tags.slug, from))
  await recomputeTagUsage([into])
  revalidateTags()
  return { ok: true }
}

/** Удалить тег из реестра и из всех списков. */
export async function deleteTag(slugRaw: string): Promise<Res> {
  await requireAdmin()
  const slug = normalizeTag(slugRaw)
  if (!slug) return { error: 'Пустой тег.' }
  await removeTagFromTemplates(slug)
  await db.delete(tags).where(eq(tags.slug, slug))
  revalidateTags()
  return { ok: true }
}

/** Отметить/снять «курируемый». */
export async function setTagCurated(slugRaw: string, curated: boolean): Promise<Res> {
  await requireAdmin()
  const slug = normalizeTag(slugRaw)
  if (!slug) return { error: 'Пустой тег.' }
  const r = await db.update(tags).set({ curated }).where(eq(tags.slug, slug))
  if (!r.rowCount) {
    if (curated) await db.insert(tags).values({ slug, curated: true }).onConflictDoNothing()
  }
  revalidateTags()
  return { ok: true }
}

/** Метка/описание тега (для курируемых). Пустое → null. */
export async function setTagMeta(slugRaw: string, label: string, description: string): Promise<Res> {
  await requireAdmin()
  const slug = normalizeTag(slugRaw)
  if (!slug) return { error: 'Пустой тег.' }
  await db
    .update(tags)
    .set({ label: label.trim() || null, description: description.trim() || null })
    .where(eq(tags.slug, slug))
  revalidateTags()
  return { ok: true }
}

/** Полный пересчёт usage_count (кнопка в админке / периодически). */
export async function refreshTagUsage(): Promise<Res> {
  await requireAdmin()
  await recomputeTagUsage()
  revalidateTags()
  return { ok: true }
}
