import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, jobs, steps, templates, templateVersions, publiclyVisible } from '@/shared/db'
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
    .where(and(eq(jobs.type, 'triples'), eq(jobs.status, 'pending')))
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
        publiclyVisible(),
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

// ── Память гномов (HQ §3, этап 2) ────────────────────────────────────
// Выжимка ремесла из ЛУЧШИХ списков доменов гнома — «учится на публикациях».
// Обновляется этой же суточной джобой, максимум MEMORY_PER_SWEEP гномов за
// прогон (размазываем расход), несвежесть > MEMORY_TTL_DAYS.

const MEMORY_TTL_DAYS = 3
const MEMORY_PER_SWEEP = 2

export async function updateGnomeMemories(): Promise<{ updated: number }> {
  const { getRosterAll } = await import('@/shared/ai/roster')
  const { arrayOverlaps } = await import('drizzle-orm')
  const { councilExperts } = await import('@/shared/db')
  const { generateText } = await import('ai')
  const { getAiChatClient } = await import('@/shared/ai/provider')
  const { getAiSettings } = await import('@/shared/settings/ai')
  const { pickChatModel } = await import('@/shared/ai/credits')
  const { spotlight } = await import('@/shared/ai/spotlight')
  const { extractUsage, outcomeOf, recordUsage } = await import('@/shared/ai/usage')

  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return { updated: 0 }

  const roster = await getRosterAll()
  const stale = roster.filter(
    (e) => e.enabled && !e.domains.includes('*'),
  )
  // Свежесть держим в БД — перечитываем поле точечно (getRosterAll поле не отдаёт).
  const rows = await db
    .select({ id: councilExperts.id, memoryUpdatedAt: councilExperts.memoryUpdatedAt })
    .from(councilExperts)
  const freshUntil = Date.now() - MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000
  const due = stale
    .filter((e) => {
      const at = rows.find((r) => r.id === e.id)?.memoryUpdatedAt
      return !at || at.getTime() < freshUntil
    })
    .slice(0, MEMORY_PER_SWEEP)

  let updated = 0
  for (const e of due) {
    // Лучшие списки его доменов: точное пересечение тегов, вес практики.
    const top = await db
      .select({ title: templates.title, desc: templates.desc, tags: templates.tags, stars: templates.starsCount })
      .from(templates)
      .where(
        and(
          publiclyVisible(),
          arrayOverlaps(templates.tags, e.domains),
        ),
      )
      .orderBy(desc(sql`${templates.starsCount} + ${templates.forksCount}`))
      .limit(5)
    if (!top.length) {
      // Домены без корпуса: свежесть всё равно фиксируем — не бьёмся в пустоту ежедневно.
      await db.update(councilExperts).set({ memoryUpdatedAt: new Date() }).where(eq(councilExperts.id, e.id))
      continue
    }
    const sp = spotlight()
    const corpus = top
      .map((t, i) => `${i + 1}. ${flat(t.title)}${flat(t.desc) ? ` — ${flat(t.desc)}` : ''} [★${t.stars}]`)
      .join('\n')
    const model = await pickChatModel(settings)
    const startedAt = Date.now()
    try {
      const result = await generateText({
        model: client.chat(model),
        system: `You distil CRAFT MEMORY for a workshop gnome (${e.guildEn || e.nameEn}) from the best lists of his domains. Write 5-8 tight bullet theses: patterns that make these lists good, recurring pitfalls, what the guild should reuse. Transferable knowledge only — no retelling of single lists. Language: match the corpus. Return ONLY the bullets.\n${sp.rule()}`,
        prompt: sp.wrap('CORPUS', corpus),
        temperature: 0.2,
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(60_000),
      })
      const u = extractUsage(result)
      await recordUsage({ feature: 'refine', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'gnome-memory', refId: undefined, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
      const memory = result.text.trim().slice(0, 1500)
      if (memory) {
        await db.update(councilExperts).set({ memory, memoryUpdatedAt: new Date() }).where(eq(councilExperts.id, e.id))
        updated++
      }
    } catch (err) {
      await recordUsage({ feature: 'refine', model, input: 0, output: 0, total: 0, cost: 0, refType: 'gnome-memory', outcome: outcomeOf(err), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    }
  }
  if (updated) log.info('gnome memories updated', { updated })
  return { updated }
}
