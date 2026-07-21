import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db, digLayers } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import type { DigLayerRow } from './actions'

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
