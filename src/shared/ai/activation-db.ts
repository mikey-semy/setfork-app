import 'server-only'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { agentActions, councilExperts, db, generationMessages } from '@/shared/db'
import { asDate } from '@/shared/db/raw'
import { stageAfterWork, stageFor, workQueue, type Candidate, type Lifecycle, type WorkSlot } from './activation'
import type { Expert } from './roster'
import { log } from '@/shared/observability'

/**
 * Политика активации НА ДАННЫХ: сколько за специалистом попыток и когда он работал последний
 * раз. Обе величины уже лежат в базе — считаем, а не заводим новое состояние.
 *
 * Попытки берём из двух источников, потому что работа у специалиста двух видов: черновики в
 * совете (generation_messages) и собственные действия петли (agent_actions). Считать только
 * первое значило бы, что самогенерация «не считается работой» — и очередь бы её игнорировала.
 */
async function attemptsAndLastWork(): Promise<Map<string, { attempts: number; last: Date | null }>> {
  const out = new Map<string, { attempts: number; last: Date | null }>()
  const bump = (id: string, n: number, at: Date | null) => {
    const prev = out.get(id) ?? { attempts: 0, last: null }
    out.set(id, { attempts: prev.attempts + n, last: !at ? prev.last : !prev.last || at > prev.last ? at : prev.last })
  }

  const drafts = await db
    .select({ who: generationMessages.who, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${generationMessages.createdAt})` })
    .from(generationMessages)
    .where(and(eq(generationMessages.kind, 'draft'), isNotNull(generationMessages.who)))
    .groupBy(generationMessages.who)
  // asDate: `last` приходит из сырого max(...) — тип там обещан вручную и может
  // оказаться строкой; дальше по коду его сравнивают и зовут .getTime().
  for (const r of drafts) if (r.who) bump(r.who, r.n, asDate(r.last))

  const acts = await db
    .select({ id: agentActions.agentId, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${agentActions.occurredAt})` })
    .from(agentActions)
    .where(and(sql`${agentActions.agentId} <> ''`, sql`${agentActions.resultStatus} <> 'dry-run'`))
    .groupBy(agentActions.agentId)
  for (const r of acts) if (r.id) bump(r.id, r.n, asDate(r.last))

  return out
}

const daysSince = (d: Date | null): number | null => (d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null)

/** Кандидаты для политики: ростер + их история. Универсалы ('*') в самогенерации не участвуют. */
export async function activationCandidates(roster: Expert[]): Promise<Candidate[]> {
  const hist = await attemptsAndLastWork()
  return roster.map((e) => {
    const h = hist.get(e.id)
    return {
      id: e.id,
      domains: e.domains.filter((d) => d && d !== '*'),
      lifecycle: (e.lifecycle as Lifecycle) ?? 'active',
      attempts: h?.attempts ?? 0,
      daysSinceWork: daysSince(h?.last ?? null),
    }
  })
}

/** Очередь работы по данным: кому нет оснований — первым (см. activation.ts). */
export async function pickWorkQueue(roster: Expert[], domain?: string, priorityDomains: string[] = [], owners: string[] = []): Promise<WorkSlot[]> {
  return workQueue(await activationCandidates(roster), domain, priorityDomains, owners)
}

/**
 * Синхронизация стадий по бездействию: активен → под риском → спит. Пишем ТОЛЬКО изменения:
 * лишние апдейты в журнале настроек выглядят как события, которых не было.
 */
export async function syncLifecycles(roster: Expert[]): Promise<{ changed: number }> {
  const cands = await activationCandidates(roster)
  let changed = 0
  for (const c of cands) {
    const next = stageFor(c)
    if (next === c.lifecycle) continue
    await db.update(councilExperts).set({ lifecycle: next }).where(eq(councilExperts.id, c.id))
    changed++
    log.info('lifecycle changed', { expert: c.id, from: c.lifecycle, to: next, daysSinceWork: c.daysSinceWork })
  }
  return { changed }
}

/** Пробуждение при выдаче работы: спящий, получивший задачу, снова активен. */
export async function wakeForWork(expertId: string, current: string): Promise<void> {
  const next = stageAfterWork((current as Lifecycle) ?? 'active')
  if (next === current) return
  await db.update(councilExperts).set({ lifecycle: next }).where(eq(councilExperts.id, expertId))
  log.info('lifecycle woken by work', { expert: expertId, from: current, to: next })
}
