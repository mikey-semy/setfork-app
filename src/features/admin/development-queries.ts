import 'server-only'
import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { agentActions, aiUsage, councilExperts, db, generationMessages, generations, knowledgeTriples, runs, stars, suggestions, templates, users } from '@/shared/db'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { getUsageTotals } from '@/shared/ai/usage'
import { AI_DAILY_USD } from '@/shared/quota'
import { REP_MIN_GENS, gnomeRank, gnomeReputation, repScore } from '@/shared/ai/gnome-reputation'
import { hireSignals, type HireSignal } from './hire'

/**
 * Дашборд РАЗВИТИЯ (Ф-D0, «капитанский мостик»): компания гномов, видимая сверху —
 * рост библиотеки, качество, деньги, корпус, штат, темы роста.
 *
 * Чем отличается от /admin/dashboard: тот — живой ОПЕРАЦИОННЫЙ мониторинг («что
 * сейчас»), этот — НАКОПЛЕННОЕ развитие («куда движемся»), как отчёт инвесторам.
 *
 * Три правила этого файла:
 *  1. Чтение. Схему не меняет, LLM не зовёт, расход не создаёт (сверяется по
 *     ai_usage: открытие страницы не должно добавлять ни одного вызова). Единственная
 *     запись — идемпотентный досев ростера внутри hireSignals() → getRosterAll(),
 *     который и так делает соседний зал совета; дублировать его логику здесь хуже.
 *  2. Честные счётчики (ADR-0005): где источника НЕТ — отдаём null и причину
 *     (см. UNAVAILABLE), а не ноль и не оценку. Ноль означает «правда ноль».
 *  3. Где цифре нельзя верить — говорим это (trusted: см. REP_MIN_GENS), а не
 *     показываем убедительный процент от двух наблюдений.
 */

/** Почему метрика недоступна честно. Это факты КОДА, не данных — поэтому статичны. */
export type NaReason = 'no-payments-table' | 'no-created-at' | 'no-taxonomy'

/**
 * Пробелы, которые Ф-D0 закрыть не может, и что их закроет:
 *  - margin: таблицы платежей/выручки в схеме нет вообще → коммерческий слой;
 *  - newProfessions: у council_experts нет created_at → колонка в PR инструментации;
 *  - domainCoverage: нормализованной таксономии доменов нет (домены — свободные
 *    строки на гноме, таблица tags не задействована) → registry таксономии.
 */
export const UNAVAILABLE: Record<'margin' | 'newProfessions' | 'domainCoverage', NaReason> = {
  margin: 'no-payments-table',
  newProfessions: 'no-created-at',
  domainCoverage: 'no-taxonomy',
}

/**
 * Участие гнома в совете. Намеренно НЕ «победы»: сейчас принятие генерации
 * засчитывается ВСЕМ, кто дал черновик (нет связи «чей черновик выбран»), поэтому
 * accepted — это «участвовал в принятой генерации». Честная атрибуция — отдельный PR;
 * до неё цифру нельзя называть заслугой.
 */
export interface GnomeParticipation {
  id: string
  nameEn: string
  nameRu: string
  gens: number
  accepted: number
  /** Доля принятых [0..1]; смотреть только при trusted. */
  score: number
  /** false — наблюдений меньше REP_MIN_GENS: показывать «—», не процент. */
  trusted: boolean
  rankEn: string
  rankRu: string
}

export interface DevelopmentMetrics {
  periodDays: number
  /** Рост библиотеки — накопленное и прирост за период. */
  library: { published: number; newInPeriod: number; forks: number; drafts: number }
  /** Качество: сигналы пользы (звёзды/прогоны) + вклад садовника. */
  quality: { stars: number; runs: number; gardenerOpen: number; gardenerAccepted: number; listsImproved: number }
  /** Деньги: только расход. Выручки/маржи в схеме нет (UNAVAILABLE.margin). */
  money: { burnToday: number; burnPeriod: number; balance: number | null; runwayGens: number | null; dailyCap: number }
  /** Корпус знаний: тройки KAG + охват добычи. */
  corpus: { triples: number; triplesNewInPeriod: number; listsMined: number }
  /** Штат. newProfessions недоступно (UNAVAILABLE.newProfessions). */
  roster: { enabled: number; total: number }
  /**
   * Приёмка по движку — главный открытый вопрос: оправдывает ли совет свою цену.
   * Разовый разбор дал совет 12→0 против одиночки 13→4; теперь это следят постоянно.
   */
  engines: { council: { gens: number; accepted: number }; single: { gens: number; accepted: number } }
  gnomes: GnomeParticipation[]
  /** Темы роста = сырой сигнал найма (LLM-теги кандидатов, не таксономия). */
  topics: HireSignal[]
}

const DAY = sql`date_trunc('day', now())`

/** Живая публичная библиотека — та же тройка условий, что и у публичного чтения. */
const publicLive = () =>
  and(eq(templates.status, 'published'), eq(templates.visibility, 'public'), eq(templates.moderation, 'active'))

const n = (rows: { n: number }[]) => rows[0]?.n ?? 0

/** Вклад садовника: сколько правок он предложил и сколько списков этим задел. */
async function gardenerContribution(): Promise<Pick<DevelopmentMetrics['quality'], 'gardenerOpen' | 'gardenerAccepted' | 'listsImproved'>> {
  // Служебного юзера НЕ создаём (страница read-only): нет его — значит садовник ещё не работал.
  const [gardener] = await db.select({ id: users.id }).from(users).where(eq(users.handle, 'gardener'))
  if (!gardener) return { gardenerOpen: 0, gardenerAccepted: 0, listsImproved: 0 }
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${suggestions.status} = 'open')::int`,
      accepted: sql<number>`count(*) filter (where ${suggestions.status} = 'accepted')::int`,
      lists: sql<number>`count(distinct ${suggestions.templateId})::int`,
    })
    .from(suggestions)
    .where(eq(suggestions.authorId, gardener.id))
  return { gardenerOpen: row?.open ?? 0, gardenerAccepted: row?.accepted ?? 0, listsImproved: row?.lists ?? 0 }
}

/**
 * ПРИЁМКА ПО ДВИЖКУ: совет против одиночной генерации.
 *
 * Зачем метрика: разовый разбор показал совет 12 → 0 принятых против одиночки 13 → 4.
 * Дорогой мультиагентный путь имел НУЛЕВУЮ приёмку — и это главный открытый вопрос
 * продукта. Разовое наблюдение забывается, поэтому делаем его постоянной цифрой:
 * вопрос решается замером, а не рассуждением о том, должен ли совет быть лучше.
 *
 * Совет отличаем по наличию черновиков С АВТОРОМ (kind='draft', who) — это факт в
 * данных, а не догадка по провенансу, которого у части записей может не быть.
 */
async function acceptanceByEngine(): Promise<DevelopmentMetrics['engines']> {
  const drafted = db
    .select({
      gid: generationMessages.generationId,
      n: sql<number>`count(distinct ${generationMessages.who})::int`.as('n'),
    })
    .from(generationMessages)
    .where(and(eq(generationMessages.kind, 'draft'), isNotNull(generationMessages.who)))
    .groupBy(generationMessages.generationId)
    .as('drafted')

  const rows = await db
    .select({
      engine: sql<string>`case when coalesce(${drafted.n}, 0) > 0 then 'council' else 'single' end`,
      gens: sql<number>`count(*)::int`,
      accepted: sql<number>`count(*) filter (where ${generations.chosenTemplateId} is not null)::int`,
    })
    .from(generations)
    .leftJoin(drafted, eq(drafted.gid, generations.id))
    .groupBy(sql`1`)

  const pick = (name: string) => {
    const r = rows.find((x) => x.engine === name)
    return { gens: r?.gens ?? 0, accepted: r?.accepted ?? 0 }
  }
  return { council: pick('council'), single: pick('single') }
}

/** Ростер + участие в совете. Читаем таблицу напрямую (getRoster* умеет писать seed). */
async function gnomeParticipation(): Promise<{ roster: DevelopmentMetrics['roster']; gnomes: GnomeParticipation[] }> {
  const [rows, rep] = await Promise.all([
    db
      .select({ id: councilExperts.id, nameEn: councilExperts.nameEn, nameRu: councilExperts.nameRu, enabled: councilExperts.enabled })
      .from(councilExperts)
      .orderBy(asc(councilExperts.sort)),
    gnomeReputation(),
  ])
  const gnomes = rows
    .filter((r) => r.enabled)
    .map((r) => {
      const seen = rep[r.id]?.gens ?? 0
      const rank = gnomeRank(rep, r.id)
      return {
        id: r.id,
        nameEn: r.nameEn,
        nameRu: r.nameRu,
        gens: seen,
        accepted: rep[r.id]?.accepted ?? 0,
        score: repScore(rep, r.id),
        trusted: seen >= REP_MIN_GENS,
        rankEn: rank.labelEn,
        rankRu: rank.labelRu,
      }
    })
    .sort((a, b) => b.gens - a.gens)
  return { roster: { enabled: gnomes.length, total: rows.length }, gnomes }
}

/** Всё для страницы одним проходом. Каждый блок — независимый SELECT, идём параллельно. */
/**
 * ДЕНЬ КОМПАНИИ — что она сделала за сутки, СВОИМИ ЖЕ записями журнала.
 *
 * Зачем: автономия без отчёта — это не автономия, а чёрный ящик. С включённой планкой
 * компания публикует сама, и владелец должен видеть постфактум: что создано, что улучшено,
 * что опубликовано, что задержано и ПО КАКОЙ ПРИЧИНЕ, где она разошлась форком.
 *
 * Считается ПО ЗАПРОСУ из agent_actions — без снимков, без джобы, без LLM. Снимок здесь был
 * бы лишним состоянием: журнал append-only, его не чистят, и день пересчитывается одинаково
 * сколько угодно раз. Поэтому нет ни идемпотентности доставки, ни таймзонных сюрпризов от
 * фонового расписания — граница суток берётся из СЕРВЕРНОГО дня Postgres, как и все
 * остальные суточные счётчики (кап расхода, кап черновиков).
 *
 * Причины задержки берём как есть из решения гейта: показывать «не прошло» без «почему» —
 * ровно то, за что мы ругали vanity-метрики.
 */
export interface CompanyDay {
  /** Смещение в днях: 0 = сегодня, 1 = вчера. */
  daysAgo: number
  created: number
  improved: number
  published: number
  held: number
  forked: number
  stable: number
  dryRun: number
  errors: number
  /** Топ-причины, по которым списки НЕ прошли планку (причина → сколько раз). */
  holdReasons: { reason: string; times: number }[]
  /** Последние события дня — человекочитаемой строкой. */
  events: { at: Date; action: string; status: string; ref: string; who: string; note: string }[]
}

const ACTION_LABEL: Record<string, keyof Pick<CompanyDay, 'created' | 'improved' | 'published' | 'held' | 'forked' | 'stable'>> = {
  'list.draft': 'created',
  'list.improve': 'improved',
  'list.publish': 'published',
  'list.hold': 'held',
  'list.fork': 'forked',
  'list.stable': 'stable',
}

/** Первая строка-причина из решения гейта (их может быть несколько — берём главную). */
function mainBlocker(decision: unknown): string {
  const b = (decision as { blockers?: unknown })?.blockers
  if (!Array.isArray(b) || !b.length) return ''
  return String(b[0]).slice(0, 120)
}

export async function getCompanyDay(daysAgo = 0): Promise<CompanyDay> {
  // Границы = серверные сутки Postgres со сдвигом: та же арифметика, что у суточных капов.
  const rows = await db
    .select({
      action: agentActions.action,
      status: agentActions.resultStatus,
      ref: agentActions.resultRef,
      agentId: agentActions.agentId,
      decision: agentActions.decision,
      error: agentActions.error,
      at: agentActions.occurredAt,
    })
    .from(agentActions)
    .where(
      sql`${agentActions.occurredAt} >= date_trunc('day', now()) - (${daysAgo}::int * interval '1 day')
          and ${agentActions.occurredAt} < date_trunc('day', now()) - ((${daysAgo}::int - 1) * interval '1 day')`,
    )
    .orderBy(desc(agentActions.occurredAt))
    .limit(500)

  const day: CompanyDay = {
    daysAgo,
    created: 0, improved: 0, published: 0, held: 0, forked: 0, stable: 0, dryRun: 0, errors: 0,
    holdReasons: [],
    events: [],
  }
  const reasons = new Map<string, number>()
  for (const r of rows) {
    if (r.status === 'dry-run') day.dryRun++
    if (r.status === 'error') day.errors++
    const key = ACTION_LABEL[r.action]
    if (key && r.status !== 'dry-run') day[key]++
    if (r.action === 'list.hold') {
      const reason = mainBlocker(r.decision)
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    if (day.events.length < 40) {
      day.events.push({
        at: r.at,
        action: r.action,
        status: r.status,
        ref: r.ref,
        who: r.agentId,
        note: r.action === 'list.hold' ? mainBlocker(r.decision) : r.error,
      })
    }
  }
  day.holdReasons = [...reasons.entries()].map(([reason, times]) => ({ reason, times })).sort((a, b) => b.times - a.times).slice(0, 6)
  return day
}

export async function getDevelopmentMetrics(periodDays = 30): Promise<DevelopmentMetrics> {
  const since = new Date(Date.now() - periodDays * 86_400_000)
  const [lib, starRows, runRows, gardener, corpus, spendToday, spendPeriod, credits, totals30, staff, topics, engines] = await Promise.all([
    db
      .select({
        published: sql<number>`count(*) filter (where ${templates.status} = 'published' and ${templates.visibility} = 'public' and ${templates.moderation} = 'active')::int`,
        newInPeriod: sql<number>`count(*) filter (where ${templates.createdAt} >= ${since} and ${templates.status} = 'published' and ${templates.visibility} = 'public' and ${templates.moderation} = 'active')::int`,
        forks: sql<number>`count(*) filter (where ${templates.forkedFromId} is not null)::int`,
        drafts: sql<number>`count(*) filter (where ${templates.status} = 'draft')::int`,
      })
      .from(templates),
    db.select({ n: sql<number>`count(*)::int` }).from(stars),
    db.select({ n: sql<number>`count(*)::int` }).from(runs),
    gardenerContribution(),
    db
      .select({
        triples: sql<number>`count(*)::int`,
        fresh: sql<number>`count(*) filter (where ${knowledgeTriples.createdAt} >= ${since})::int`,
      })
      .from(knowledgeTriples),
    db.select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` }).from(aiUsage).where(gte(aiUsage.createdAt, DAY)),
    db.select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` }).from(aiUsage).where(gte(aiUsage.createdAt, since)),
    getOpenRouterCredits(),
    getUsageTotals(30),
    gnomeParticipation(),
    hireSignals(),
    acceptanceByEngine(),
  ])
  const [minedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(publicLive(), isNotNull(templates.triplesMinedAt)))

  const avgPerGen = totals30.generations > 0 ? totals30.costUsd / totals30.generations : null
  const balance = credits?.remaining ?? null
  const runwayGens = balance != null && avgPerGen && avgPerGen > 0 ? Math.floor(balance / avgPerGen) : null

  return {
    periodDays,
    library: {
      published: lib[0]?.published ?? 0,
      newInPeriod: lib[0]?.newInPeriod ?? 0,
      forks: lib[0]?.forks ?? 0,
      drafts: lib[0]?.drafts ?? 0,
    },
    quality: { stars: n(starRows), runs: n(runRows), ...gardener },
    money: {
      burnToday: spendToday[0]?.usd ?? 0,
      burnPeriod: spendPeriod[0]?.usd ?? 0,
      balance,
      runwayGens,
      dailyCap: AI_DAILY_USD,
    },
    corpus: { triples: corpus[0]?.triples ?? 0, triplesNewInPeriod: corpus[0]?.fresh ?? 0, listsMined: minedRow?.n ?? 0 },
    roster: staff.roster,
    engines,
    gnomes: staff.gnomes,
    topics,
  }
}
