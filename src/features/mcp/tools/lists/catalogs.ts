import 'server-only'
import { asc, eq, sql } from 'drizzle-orm'
import { db, repositories, templates } from '@/shared/db'

/**
 * ПОЛКИ ВЛАДЕЛЬЦА — чтобы ассистенту было что назвать при создании списка.
 *
 * Без этого инструмента параметр `catalog` был почти нерабочим: в интерфейсе полка
 * показана видимым заголовком («Скиллы»), а раскладка искала техническое имя (`skills`),
 * и узнать его ассистенту было неоткуда — он раз за разом получал бы «нет такой полки»
 * (находка авто-ревью). Поэтому здесь отдаются ОБА имени сразу.
 *
 * Заодно видно, сколько списков уже лежит на полке: это единственная подсказка о том, для
 * чего полка заведена, когда заголовок короток.
 */
export interface McpCatalogRow {
  /** Техническое имя — его и передавать в `catalog` при создании. */
  name: string
  /** Как полка подписана в интерфейсе. */
  title: string
  lists: number
}

export async function mcpMyCatalogs(userId: string): Promise<{ count: number; catalogs: McpCatalogRow[] }> {
  const rows = await db
    .select({
      name: repositories.name,
      title: repositories.title,
      lists: sql<number>`(select count(*)::int from ${templates} t where t.repository_id = ${repositories.id})`,
    })
    .from(repositories)
    .where(eq(repositories.ownerId, userId))
    .orderBy(asc(repositories.name))

  return {
    count: rows.length,
    catalogs: rows.map((r) => ({
      name: r.name,
      // Заголовок берём первый непустой по всем языкам: ассистенту нужен ориентир, а не
      // языковая политика, и пустой заголовок здесь хуже «неправильного» языка.
      title: Object.values((r.title ?? {}) as Record<string, string>).find(Boolean) ?? r.name,
      lists: r.lists,
    })),
  }
}
