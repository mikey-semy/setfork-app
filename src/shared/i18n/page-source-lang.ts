import 'server-only'
import { cache } from 'react'
import { and, eq, sql } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { publiclyVisible } from '@/shared/db/visibility'
import { RESERVED_TOP } from '@/shared/nav/reserved-top'
import { textLang } from './detect-text-lang'

/**
 * ЯЗЫК ОРИГИНАЛА СПИСКА, НА СТРАНИЦЕ КОТОРОГО МЫ НАХОДИМСЯ, — по адресу запроса.
 *
 * Нужен зрителю без предпочтения языка — роботу, который не шлёт ни куки, ни
 * `Accept-Language`: ему страница списка отдаётся на языке самого списка (ADR-0030), а не на
 * английском по умолчанию. Русский список робот видит русской страницей целиком, включая
 * `<html lang>`, — языка в адресе нет (ADR-0029), и другого способа сказать поисковику
 * «эта страница русская» у страницы нет.
 *
 * Только ПУБЛИЧНЫЙ список (`publiclyVisible`): язык чужого приватного списка не должен
 * просачиваться даже сменой языка интерфейса. `templates.lang` пуст (списки до ADR-0030) —
 * угадываем по алфавиту названия. Сбой базы — `null`: язык страницы не повод её ронять.
 *
 * `cache` — один запрос на рендер: язык спрашивают корневой макет, страница и метаданные.
 */
export const pageSourceLang = cache(async (path: string | null): Promise<string | null> => {
  const m = path ? /^\/([^/?#]+)\/([^/?#]+)/.exec(path) : null
  // Корневые разделы (`/tags/…`, `/admin/…`) — не список: ника с таким именем не бывает, так что
  // это не правило, а экономия запроса к базе на каждом их просмотре роботом.
  if (!m || RESERVED_TOP.has(m[1])) return null
  let slug: string
  try {
    slug = decodeURIComponent(m[2])
  } catch {
    return null
  }
  try {
    const [row] = await db
      .select({ lang: templates.lang, title: templates.title })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .where(and(eq(sql`lower(${users.handle})`, m[1].toLowerCase()), eq(templates.slug, slug), publiclyVisible()))
      .limit(1)
    if (!row) return null
    return row.lang || textLang(Object.values(row.title ?? {}))
  } catch {
    return null
  }
})
