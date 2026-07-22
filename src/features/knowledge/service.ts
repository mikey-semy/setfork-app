import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, jobs, steps, templates, templateVersions } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { extractTriples, saveTriples } from '@/shared/ai/triples'
import { globalBudgetOk } from '@/shared/quota'
import { isAiAvailable } from '@/shared/settings/ai'
import { log } from '@/shared/observability'
import type { LocaleText } from '@/shared/i18n'

/**
 * Рудник знаний (HQ §5): фоновое извлечение троек из опубликованных списков —
 * по образцу садовника (самоподдерживающаяся джоба, батчи, уважение бюджета).
 * Один прогон в сутки, BATCH списков, из которых тройки ещё не извлекались.
 */

const TRIPLES_EVERY_DAYS = 1
const BATCH = Number(process.env.TRIPLES_BATCH ?? 5)

export async function ensureTriplesScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'triples'), inArray(jobs.status, ['pending', 'processing'])))
    .limit(1)
  if (pending.length) return
  await enqueueJob('triples', {}, { delayMs: TRIPLES_EVERY_DAYS * 24 * 60 * 60 * 1000, maxAttempts: 1 })
  log.info('triples scheduled', { inDays: TRIPLES_EVERY_DAYS })
}

const flat = (t: LocaleText | null | undefined): string => (t ? Object.values(t).filter(Boolean).join(' / ') : '')

export async function runTriplesSweep(): Promise<{ mined: number; skipped: number }> {
  if (!(await isAiAvailable())) return { mined: 0, skipped: 0 }
  if (!(await globalBudgetOk())) {
    log.info('triples: global AI budget exhausted, skipping')
    return { mined: 0, skipped: 0 }
  }

  // Публичные списки, где рудник ещё не был (или список правился после добычи).
  // Маркер triples_mined_at ставится независимо от урожая — «пустой» список не
  // перерабатывается ежедневно (фикс по ревью волны).
  const batch = await db
    .select({ id: templates.id, title: templates.title, desc: templates.desc, currentVersion: templates.currentVersion })
    .from(templates)
    .where(
      and(
        eq(templates.status, 'published'),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        sql`(${templates.triplesMinedAt} is null or ${templates.triplesMinedAt} < ${templates.updatedAt})`,
      ),
    )
    .orderBy(desc(templates.updatedAt))
    .limit(BATCH)

  let mined = 0
  let skipped = 0
  for (const tpl of batch) {
    const [ver] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.currentVersion)))
    const rows = ver ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n)) : []
    const text = [
      flat(tpl.title),
      flat(tpl.desc),
      ...rows.filter((s) => !s.type || s.type === 'step').map((s, i) => `${i + 1}. ${flat(s.title)}${flat(s.desc) ? ` — ${flat(s.desc)}` : ''}${flat(s.why) ? ` (why: ${flat(s.why)})` : ''}`),
    ]
      .filter(Boolean)
      .join('\n')
    if (text.length < 60) {
      skipped++
      await db.update(templates).set({ triplesMinedAt: new Date() }).where(eq(templates.id, tpl.id))
      continue
    }
    // Язык троек — язык заголовка (двуязычные пишут обе локали через « / » — модель берёт как есть).
    const lang = (tpl.title as LocaleText)?.ru && !(tpl.title as LocaleText)?.en ? 'ru' : 'en'
    const triples = await extractTriples(text, { templateId: tpl.id })
    if (triples.length) {
      await saveTriples(triples, lang, tpl.id)
      mined += triples.length
    } else {
      skipped++
    }
    // Маркер — ВСЕГДА, даже при нулевом урожае: рудник не возвращается впустую.
    await db.update(templates).set({ triplesMinedAt: new Date() }).where(eq(templates.id, tpl.id))
  }
  log.info('triples sweep done', { batch: batch.length, mined, skipped })
  return { mined, skipped }
}
