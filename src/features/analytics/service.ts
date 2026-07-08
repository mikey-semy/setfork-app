import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { db, linkClicks, templates, templateViews } from '@/shared/db'
import { isBot, dayUtc, visitorKey } from './visitor'

// Трафик-аналитика (Ф-M0 монетизации): уникальные дневные просмотры списка и
// журнал кликов по внешним ссылкам. Всё best-effort — сбой записи не должен
// ломать страницу или редирект (вызывающие оборачивают в catch).

export { isBot, dayUtc, visitorKey }

/** Просмотр: дедуп по (список, посетитель, день); новый → инкремент viewsCount. */
export async function recordView(templateId: string, userId: string | null, visitor: string): Promise<void> {
  const inserted = await db
    .insert(templateViews)
    .values({ templateId, userId, visitor, day: dayUtc() })
    .onConflictDoNothing({ target: [templateViews.templateId, templateViews.visitor, templateViews.day] })
    .returning({ id: templateViews.id })
  if (inserted.length > 0) {
    await db
      .update(templates)
      .set({ viewsCount: sql`${templates.viewsCount} + 1` })
      .where(eq(templates.id, templateId))
  }
}

/** Клик по внешней ссылке: журнал с снапшотом url (host — для сводок по доменам). */
export async function recordClick(row: {
  templateId: string
  stepId: string | null
  refIndex: number
  url: string
  userId: string | null
  visitor: string
}): Promise<void> {
  let host = ''
  try {
    host = new URL(row.url).hostname
  } catch {
    // некорректный url — журналим с пустым host
  }
  await db.insert(linkClicks).values({ ...row, host })
}
