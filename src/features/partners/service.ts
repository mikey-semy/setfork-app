import 'server-only'
import { and, arrayOverlaps, count, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm'
import { agendaItems, db, feedItems, generations, jobs, linkChecks, linkOccurrences, templates, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { autonomyHealthy } from '@/shared/agents/canary'
import { COVERAGE_TARGET, agendaKey, coverageStrength, rankAgenda, type AgendaSignal } from '@/shared/agents/agenda'
import { getRoster } from '@/shared/ai/roster'
import { log } from '@/shared/observability'
export { approvedDomains } from '@/shared/agents/agenda-db'

/**
 * ПЕТЛЯ ПАРТНЁРОВ — двигатель развития компании.
 *
 * Верхний слой штата (Методолог, Хранитель качества, Планировщик развития) до сих пор
 * существовал только как три аккаунта: работы у них не было, и компания умела производить, но
 * не умела решать, ЧТО производить дальше — тему выбирал каждый специалист сам за себя.
 *
 * Что делает проход: собирает сигналы из чисел, которые уже есть в БД, ранжирует их в повестку
 * и кладёт наверх — гендиректору. НИ ОДНОГО ВЫЗОВА МОДЕЛИ: спрашивать модель «что развивать»
 * значит платить за мнение вместо замера.
 *
 * Ритм недельный (докладная: «Партнёры ежедневно не действуют»): повестка — не новостная лента,
 * а рамка на период, и дёргать её чаще значит мешать работать.
 */

const EVERY_DAYS = 7

/** Сколько пунктов держим в повестке. Длинный список — это не приоритеты, а свалка. */
const AGENDA_LIMIT = 12

/** Окно наблюдения за спросом. */
const DEMAND_DAYS = 30

/** Лента, не выросшая столько дней, считается заглохшей (планка ленты — те же 7). */
const FEED_STALE_DAYS = 7

export async function ensurePartnersScheduled(): Promise<void> {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'partners'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending) return
  await enqueueJob('partners', {}, { delayMs: EVERY_DAYS * 24 * 60 * 60 * 1000, maxAttempts: 1 })
}

/**
 * ПОКРЫТИЕ: домены специалистов против того, что в библиотеке реально есть.
 * Пустой домен — это не «плохо работали», а «здесь ещё ничего нет»: самый честный повод расти.
 */
async function coverageSignals(): Promise<AgendaSignal[]> {
  const roster = await getRoster()
  const domains = [...new Set(roster.flatMap((e) => e.domains).filter((d) => d && d !== '*'))]
  if (!domains.length) return []
  const out: AgendaSignal[] = []
  for (const domain of domains) {
    const [row] = await db
      .select({ n: count() })
      .from(templates)
      .where(
        and(
          eq(templates.status, 'published'),
          eq(templates.visibility, 'public'),
          eq(templates.moderation, 'active'),
          arrayOverlaps(templates.tags, [domain]),
        ),
      )
    const lists = row?.n ?? 0
    const strength = coverageStrength(lists)
    if (strength <= 0) continue
    out.push({
      kind: lists === 0 ? 'canon' : 'deepen',
      domain,
      strength,
      why: { lists, target: COVERAGE_TARGET },
    })
  }
  return out
}

/**
 * СПРОС: человек спросил — принятого списка не появилось. Классифицировать такие запросы по
 * темам нечем (запрос это свободный текст, тегов у него нет), поэтому НЕ выдумываем разбивку,
 * а даём один честный агрегат. Ложная точность здесь хуже отсутствия.
 */
async function demandSignals(): Promise<AgendaSignal[]> {
  const since = new Date(Date.now() - DEMAND_DAYS * 86_400_000)
  const [row] = await db
    .select({
      total: count(),
      unanswered: sql<number>`count(*) filter (where ${generations.chosenTemplateId} is null)::int`,
    })
    .from(generations)
    .where(gte(generations.createdAt, since))
  const total = row?.total ?? 0
  const unanswered = row?.unanswered ?? 0
  if (!total || !unanswered) return []
  return [
    {
      kind: 'demand',
      domain: '',
      strength: unanswered / total,
      why: { unanswered, total, days: DEMAND_DAYS },
    },
  ]
}

/**
 * КАЧЕСТВО: мёртвые ссылки в опубликованном. Считаем по спискам, а не по ссылкам: владельцу
 * важно, сколько списков врут читателю, а не сколько всего битых адресов.
 */
async function qualitySignals(): Promise<AgendaSignal[]> {
  // Битая ссылка живёт в реестре адресов (link_checks), а её принадлежность списку — в
  // реестре вхождений (link_occurrences). Соединяем через оба: иначе «мёртвых ссылок» было бы
  // видно много, а чей это список — неизвестно.
  const rows = await db
    .select({ tags: templates.tags })
    .from(templates)
    .innerJoin(linkOccurrences, eq(linkOccurrences.templateId, templates.id))
    .innerJoin(linkChecks, eq(linkChecks.urlNorm, linkOccurrences.urlNorm))
    .where(
      and(
        eq(templates.status, 'published'),
        eq(templates.moderation, 'active'),
        inArray(linkChecks.verdict, ['broken', 'unreachable']),
      ),
    )
    .groupBy(templates.id, templates.tags)
  if (!rows.length) return []
  const byDomain = new Map<string, number>()
  for (const r of rows) for (const t of r.tags.slice(0, 3)) byDomain.set(t, (byDomain.get(t) ?? 0) + 1)
  return [...byDomain.entries()].map(([domain, lists]) => ({
    kind: 'quality' as const,
    domain,
    // Пять списков с мёртвыми ссылками в одной теме — уже полная острота: дальше расти нечему.
    strength: Math.min(1, lists / 5),
    why: { listsWithDeadLinks: lists },
  }))
}

/**
 * СВЕЖЕСТЬ ЛЕНТ: живой список, в который давно ничего не пришло, врёт читателю самим фактом
 * существования. Это работа резерва (собственные нужды), а не развития.
 */
async function feedSignals(): Promise<AgendaSignal[]> {
  const rows = await db
    .select({
      slug: templates.slug,
      tags: templates.tags,
      freshest: sql<Date | null>`(select max(coalesce(fi.published_at, fi.created_at)) from ${feedItems} fi where fi.used_template_id = ${templates.id})`,
    })
    .from(templates)
    .where(and(eq(templates.living, true), isNull(templates.archivedAt)))
  const out: AgendaSignal[] = []
  for (const r of rows) {
    const days = r.freshest ? Math.floor((Date.now() - new Date(r.freshest).getTime()) / 86_400_000) : null
    if (days != null && days <= FEED_STALE_DAYS) continue
    out.push({
      kind: 'feed',
      domain: r.tags[0] ?? r.slug,
      // Две планки простоя = полная острота: лента, молчащая две недели, уже не лента.
      strength: days == null ? 0.5 : Math.min(1, days / (FEED_STALE_DAYS * 2)),
      why: days == null ? { feed: r.slug, material: 'нет материала из потока' } : { feed: r.slug, staleDays: days },
    })
  }
  return out
}

/** НАЙМ: темы, по которым у нас нет профильного мастера (сырой сигнал, как и раньше). */
async function hireSignalsAsAgenda(): Promise<AgendaSignal[]> {
  const { hireSignals } = await import('@/shared/ai/hire-signals')
  const rows = await hireSignals()
  return rows.slice(0, 5).map((s) => ({
    kind: 'hire' as const,
    domain: s.tag,
    // Три списка по непокрытой теме — уже повод: дальше острота не растёт, растёт долг.
    strength: Math.min(1, s.n / 3),
    why: { listsWithoutMaster: s.n },
  }))
}

export interface AgendaSweepResult {
  proposed: number
  updated: number
  closed: number
}

/**
 * Один проход двигателя: собрать сигналы → ранжировать → положить повестку.
 *
 * Решение человека НЕПРИКОСНОВЕННО: одобренный пункт обновляем по числам, но статус не трогаем,
 * а отклонённый не воскрешаем — иначе петля спорила бы с гендиректором каждую неделю.
 */
export async function runPartnersSweep(): Promise<AgendaSweepResult> {
  await ensurePartnersScheduled()
  const out: AgendaSweepResult = { proposed: 0, updated: 0, closed: 0 }
  if (!(await autonomyHealthy('partners'))) {
    log.info('partners: circuit tripped by canary, skipping sweep')
    return out
  }
  const policy = await loopPolicy('partners')

  const signals = (await Promise.all([coverageSignals(), demandSignals(), qualitySignals(), feedSignals(), hireSignalsAsAgenda()])).flat()
  const agenda = rankAgenda(signals, AGENDA_LIMIT)

  if (policy.dryRun) {
    await recordAgentAction({
      loop: 'partners',
      action: 'agenda.review',
      resultStatus: 'dry-run',
      signal: { signals: signals.length },
      decision: { wouldPropose: agenda.length, top: agenda.slice(0, 3).map((i) => agendaKey(i.kind, i.domain)) },
      policyVersion: policy.policyVersion,
    })
    return out
  }

  const seen = new Set<string>()
  for (const item of agenda) {
    const key = agendaKey(item.kind, item.domain)
    seen.add(key)
    const [existing] = await db.select({ id: agendaItems.id, status: agendaItems.status }).from(agendaItems).where(eq(agendaItems.key, key))
    if (!existing) {
      await db.insert(agendaItems).values({ kind: item.kind, domain: item.domain, key, score: item.score, why: item.why })
      out.proposed++
      continue
    }
    // Отклонённое не воскрешаем: человек уже сказал «нет», и повторять вопрос каждую неделю —
    // это не автономия, а навязчивость.
    if (existing.status === 'dismissed') continue
    await db.update(agendaItems).set({ score: item.score, why: item.why, updatedAt: new Date() }).where(eq(agendaItems.id, existing.id))
    out.updated++
  }

  // Пункт, чей сигнал ИСЧЕЗ (тему закрыли, ссылки починили, лента ожила), закрываем сами:
  // повестка обязана показывать сегодняшнюю картину, а не архив намерений.
  const stale = await db
    .select({ id: agendaItems.id, key: agendaItems.key })
    .from(agendaItems)
    .where(and(ne(agendaItems.status, 'dismissed'), ne(agendaItems.status, 'done')))
  for (const row of stale) {
    if (seen.has(row.key)) continue
    await db.update(agendaItems).set({ status: 'done', doneAt: new Date(), updatedAt: new Date() }).where(eq(agendaItems.id, row.id))
    out.closed++
  }

  await recordAgentAction({
    loop: 'partners',
    action: 'agenda.review',
    resultStatus: 'ok',
    signal: { signals: signals.length },
    decision: { ...out, top: agenda.slice(0, 3).map((i) => agendaKey(i.kind, i.domain)) },
    policyVersion: policy.policyVersion,
  })
  log.info('partners sweep done', { ...out })
  return out
}

/** Повестка для админки: сначала неразобранное, внутри — по счёту. */
export async function currentAgenda(limit = 20) {
  return db
    .select({
      id: agendaItems.id,
      kind: agendaItems.kind,
      domain: agendaItems.domain,
      score: agendaItems.score,
      why: agendaItems.why,
      status: agendaItems.status,
      createdAt: agendaItems.createdAt,
      decidedBy: users.handle,
    })
    .from(agendaItems)
    .leftJoin(users, eq(users.id, agendaItems.decidedBy))
    .where(ne(agendaItems.status, 'done'))
    .orderBy(sql`case ${agendaItems.status} when 'proposed' then 0 when 'approved' then 1 else 2 end`, desc(agendaItems.score))
    .limit(limit)
}

export async function runPartnersJob(): Promise<void> {
  try {
    await runPartnersSweep()
  } finally {
    await ensurePartnersScheduled()
  }
}
