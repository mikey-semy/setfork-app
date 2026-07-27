import 'server-only'
import { sql } from 'drizzle-orm'
import { db, tags, templates } from '@/shared/db'

// Внутренние помощники реестра тегов (не 'use server' — зовутся server-side).
// Публичные (client-invoked) мутации — в ./actions с requireAdmin.

/** Регистрируем slug'и в реестре при создании/правке списка (новые → uncurated). */
export async function registerTags(slugs: string[]): Promise<void> {
  const clean = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
  if (!clean.length) return
  await db
    .insert(tags)
    .values(clean.map((slug) => ({ slug })))
    .onConflictDoNothing()
}

/** Пересчёт usage_count (публичные активные списки с тегом). Не hot-path:
 *  зовём после админ-мутаций и периодически. only — ограничить набором slug'ов. */
export async function recomputeTagUsage(only?: string[]): Promise<void> {
  await db.execute(sql`
    update ${tags} as t set usage_count = coalesce((
      select count(*)::int from ${templates} tp
      where t.slug = any(tp.tags)
        and tp.visibility = 'public' and tp.status = 'published' and tp.moderation = 'active'
    ), 0)
    ${only && only.length ? sql`where t.slug = any(${sql.param(only)}::text[])` : sql``}
  `)
}

/** Заменить slug from→to во ВСЕХ списках (с дедупом массива). Основа rename/merge. */
export async function replaceTagInTemplates(from: string, to: string): Promise<void> {
  await db.execute(sql`
    update ${templates} set tags = (
      select coalesce(array_agg(distinct case when x = ${from} then ${to} else x end), '{}')
      from unnest(tags) as x
    )
    where ${from} = any(tags)
  `)
}

/** Убрать slug из массивов всех списков (для delete). */
export async function removeTagFromTemplates(slug: string): Promise<void> {
  await db.execute(sql`update ${templates} set tags = array_remove(tags, ${slug}) where ${slug} = any(tags)`)
}
