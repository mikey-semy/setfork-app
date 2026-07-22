import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db, digChatMessages, digLayers } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import type { DigLayerRow } from './actions'

/**
 * Номера шагов, у которых есть СОХРАНЁННАЯ dig-сессия этого пользователя — чтобы
 * кирка на пункте показывала точку «здесь уже копали» (фидбек владельца). Resilient:
 * нет таблицы (не-мигрированная дев-БД) или сбой → пустое множество, страница не падает.
 */
export async function digStepsWithSession(templateId: string, userId: string): Promise<Set<number>> {
  try {
    const rows = await db
      .selectDistinct({ stepN: digChatMessages.stepN })
      .from(digChatMessages)
      .where(and(eq(digChatMessages.templateId, templateId), eq(digChatMessages.userId, userId)))
    return new Set(rows.map((r) => r.stepN))
  } catch {
    return new Set()
  }
}

/** Все выкопанные слои списка (текущая версия, язык зрителя) одной выборкой — по шагам. */
export async function digLayersFor(templateId: string, version: number, lang: Lang): Promise<Map<number, DigLayerRow[]>> {
  const rows = await db
    .select({ stepN: digLayers.stepN, level: digLayers.level, content: digLayers.content })
    .from(digLayers)
    .where(and(eq(digLayers.templateId, templateId), eq(digLayers.version, version), eq(digLayers.lang, lang)))
    .orderBy(asc(digLayers.stepN), asc(digLayers.level))
  const out = new Map<number, DigLayerRow[]>()
  for (const r of rows) {
    const arr = out.get(r.stepN) ?? []
    arr.push({ level: r.level, content: r.content })
    out.set(r.stepN, arr)
  }
  return out
}
