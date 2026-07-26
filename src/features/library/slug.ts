// Плоские хелперы слагов/тегов — вынесены из actions.ts, чтобы переиспользовать
// в generation (из 'use server'-файла нельзя экспортировать синхронные функции).

export function parseTags(raw: unknown): string[] {
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

import { translitRu } from '@/shared/lib/translit'

export function slugify(input: string): string {
  return (
    // Кириллица транслитерируется, а не вырезается: раньше русский заголовок
    // давал слаг «-» (реальный случай: MCP-создание «Домашнее маршмеллоу»).
    translitRu(input)
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      // Крайние дефисы срезаем ДО фолбэка: заголовок из одних разделителей
      // («— —», «...») иначе давал слаг «-», и адрес /owner/-/releases выглядел
      // как сломанный роут. Теперь такой заголовок честно уходит в 'list'.
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'list'
  )
}

/** Уникальный слаг в рамках владельца: добавляет короткий суффикс при коллизии. */
export async function uniqueSlug(
  base: string,
  ownerId: string,
): Promise<string> {
  const [{ db, templates }, { and, eq }] = await Promise.all([import('@/shared/db'), import('drizzle-orm')])
  const slug = slugify(base)
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, ownerId), eq(templates.slug, slug)))
  return owned.length ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
}
