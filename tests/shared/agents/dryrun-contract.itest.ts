import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * СУХОЙ ПРОГОН обязателен для КАЖДОЙ автономной петли.
 *
 * Рубильник показан в админке для всех петель. Петля, которая его не читает, хуже
 * отсутствия рубильника: человек видит «сухой прогон включён» и думает, что смотрит
 * на репетицию, а петля тем временем работает вживую — тратит деньги на модель,
 * ходит по чужим ссылкам, шлёт людям письма.
 *
 * Проверяем не «есть ли в коде слово dryRun», а поведение: при включённом сухом
 * прогоне петля НИЧЕГО не делает и оставляет в журнале запись 'dry-run'.
 */
vi.mock('@/shared/ai/provider', () => ({ getAiChatClient: async () => null, isAiAvailable: async () => true }))
vi.mock('@/shared/email/mailer', () => ({ sendMail: vi.fn(async () => {}) }))

const { agentActions, db, templates, users } = await import('@/shared/db')
const { setLoopDryRun } = await import('@/shared/agents/policy')
const { runTriplesSweep } = await import('@/features/knowledge/service')
const { runLinkcheckSweep } = await import('@/features/linkcheck/service')
const { runWeeklyDigestSweep } = await import('@/features/digest/service')
const { saveSettings } = await import('@/shared/settings/kv')

const journalFor = async (loop: string) =>
  (await db.select().from(agentActions)).filter((a) => a.loop === loop)

beforeEach(async () => {
  await resetTables([agentActions, templates, users])
})

describe('сухой прогон уважает каждая петля', () => {
  it('рудник знаний: включён сухой прогон → добычи нет, в журнале dry-run', async () => {
    await setLoopDryRun('triples', true)
    const res = await runTriplesSweep()
    expect(res.mined).toBe(0)
    const acts = await journalFor('triples')
    expect(acts).toHaveLength(1)
    expect(acts[0].resultStatus).toBe('dry-run')
  })

  it('обходчик ссылок: включён сухой прогон → ни одной пробы', async () => {
    // Обходчик по умолчанию выключен — включаем, иначе проверялся бы не сухой прогон,
    // а выключенный тумблер (петля и так ничего не делает).
    await saveSettings({ 'linkcheck.enabled': 'true' })
    await setLoopDryRun('linkcheck', true)
    // Проба падает, если её позовут: при сухом прогоне до неё дойти нельзя.
    const res = await runLinkcheckSweep({}, async () => {
      throw new Error('проба вызвана при сухом прогоне')
    })
    expect(res.probed).toBe(0)
    expect((await journalFor('linkcheck'))[0]?.resultStatus).toBe('dry-run')
  })

  it('дайджест: включён сухой прогон → писем нет', async () => {
    await setLoopDryRun('digest', true)
    const res = await runWeeklyDigestSweep()
    expect(res.sent).toBe(0)
    expect((await journalFor('digest'))[0]?.resultStatus).toBe('dry-run')
  })
})
