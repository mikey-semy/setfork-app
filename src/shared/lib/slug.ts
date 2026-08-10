// Слаги и теги списка — инфраструктура записи, не фича.
//
// Лежало в features/library/slug.ts, но нужно ВСЕМ, кто создаёт списки: генерация, MCP,
// каталоги, админка и петля ухода (расхождение форком). Для features/gardener это означало
// бы третий кросс-импорт в library — а границы слоёв запрещают фичам видеть друг друга (и
// правильно: цепочка «садовник → library → …» уже дважды приводила к запутанным зависимостям).
// Поэтому helpers переехали в shared, а features/library/slug.ts остался ре-экспортом,
// чтобы существующие импорты не переписывать одним махом.

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

/**
 * Свободен ли слаг у этого владельца.
 *
 * Занятым считается и ПРЕЖНИЙ адрес переименованного списка: он всё ещё ведёт на
 * него — из чужих ссылок, из git remote в клонах, из памяти агентов. Отдать такой
 * слаг новому списку значило бы увести чужой трафик на другой контент; именно здесь
 * мы расходимся с Gitea и GitHub, где освободившееся имя занимается заново.
 */
async function slugTaken(slug: string, ownerId: string, exceptTemplateId?: string): Promise<boolean> {
  const [{ db, listRedirects, templates }, { and, eq, ne }] = await Promise.all([
    import('@/shared/db'),
    import('drizzle-orm'),
  ])
  const [live, previous] = await Promise.all([
    db
      .select({ slug: templates.slug })
      .from(templates)
      .where(and(eq(templates.ownerId, ownerId), eq(templates.slug, slug)))
      .limit(1),
    db
      .select({ slug: listRedirects.slug })
      .from(listRedirects)
      .where(
        and(
          eq(listRedirects.ownerId, ownerId),
          eq(listRedirects.slug, slug),
          // СВОИ прежние адреса занятыми не считаются — иначе к прежнему имени нельзя
          // вернуться: переименовал `a` → `b`, а обратно уже «занято» самим собой.
          ...(exceptTemplateId ? [ne(listRedirects.templateId, exceptTemplateId)] : []),
        ),
      )
      .limit(1),
  ])
  return live.length > 0 || previous.length > 0
}

/** Уникальный слаг в рамках владельца: добавляет короткий суффикс при коллизии. */
export async function uniqueSlug(base: string, ownerId: string): Promise<string> {
  const slug = slugify(base)
  return (await slugTaken(slug, ownerId)) ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
}

/** Слаг, введённый человеком при переименовании: та же нормализация и та же занятость. */
export async function checkSlugAvailable(
  raw: string,
  ownerId: string,
  /** Список, который переименовывают: его собственные прежние адреса свободны для него. */
  templateId?: string,
): Promise<{ slug: string; free: boolean }> {
  const slug = slugify(raw)
  return { slug, free: !(await slugTaken(slug, ownerId, templateId)) }
}
