import { and, desc, eq, sql } from 'drizzle-orm'
import { db, templates, publiclyVisible } from '@/shared/db'
import { tr, type Lang } from '@/shared/i18n'

// Заголовки НАСТОЯЩИХ публичных списков — общий источник «живых» подсказок для
// главной (чипы) и старта генерации (варианты как у поисковика). Один запрос, чтобы
// не расходиться: популярные, коротко, без дублей, перемешанные.
const POOL = 100

/** До `max` заголовков активных публичных списков (по популярности), перемешанных. Пусто → []. */
export async function sampleListTitles(lang: Lang, max = POOL): Promise<string[]> {
  const rows = await db
    .select({ title: templates.title })
    .from(templates)
    .where(and(publiclyVisible()))
    .orderBy(desc(sql`${templates.starsCount} + ${templates.forksCount}`))
    .limit(POOL)
  const titles = [...new Set(rows.map((r) => tr(r.title, lang).trim()).filter((s) => s.length > 0 && s.length <= 46))]
  for (let i = titles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[titles[i], titles[j]] = [titles[j], titles[i]]
  }
  return titles.slice(0, max)
}
