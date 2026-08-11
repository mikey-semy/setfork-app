import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Бэк-офис на реальной БД. Почту мокаем: проверяем не доставку письма, а поведение петли —
// что тревога уходит наверх, что тишина не рассылается, что сухой прогон ничего не отправляет
// и что каждое решение попадает в журнал.
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[], ok: true }))
vi.mock('@/shared/email/mailer', () => ({
  sendMail: vi.fn(async (msg: { to: string; subject: string }) => {
    if (!mail.ok) return false
    mail.sent.push({ to: msg.to, subject: msg.subject })
    return true
  }),
}))
vi.mock('@/shared/ai/credits', () => ({ getOpenRouterCredits: vi.fn(async () => ({ remaining: 1 })) }))

const { agentActions, agentLoops, aiUsage, db, jobs, users } = await import('@/shared/db')
const { runChronicleSweep, runFinanceSweep } = await import('@/features/backoffice/service')
const { setLoopDryRun } = await import('@/shared/agents/policy')

let adminId = ''

beforeAll(async () => {
  process.env.ADMIN_HANDLES = 'boss'
  await resetTables([agentActions, agentLoops, aiUsage, jobs, users])
  const [u] = await db.insert(users).values({ handle: 'boss', email: 'boss@example.com' }).returning({ id: users.id })
  adminId = u.id
  // Не-админ с почтой: письма компании ему уходить не должны.
  await db.insert(users).values({ handle: 'stranger', email: 'stranger@example.com' })
})

beforeEach(async () => {
  await db.delete(agentActions)
  await db.delete(agentLoops)
  await db.delete(aiUsage)
  await db.delete(jobs)
  mail.sent = []
  mail.ok = true
})

const spend = async (usd: number, daysAgo = 0) => {
  await db.insert(aiUsage).values({
    userId: adminId,
    feature: 'generate',
    model: 'm',
    costUsd: String(usd),
    createdAt: sql`now() - (${daysAgo}::int * interval '1 day')`,
  })
}
const journal = async () => db.select().from(agentActions)

describe('бухгалтер', () => {
  it('спокойный день: тревог нет, но проход всё равно виден в журнале', async () => {
    const res = await runFinanceSweep()
    expect(res.alerts).toBe(0)
    expect(mail.sent).toHaveLength(0)
    const acts = await journal()
    expect(acts.some((a) => a.loop === 'finance' && a.action === 'money.watch')).toBe(true)
  })

  it('короткий остаток — письмо владельцу и запись «тревога»', async () => {
    await spend(1)
    const res = await runFinanceSweep()
    expect(res.alerts).toBeGreaterThan(0)
    expect(mail.sent.map((m) => m.to)).toEqual(['boss@example.com'])
    const acts = await journal()
    expect(acts.some((a) => a.action === 'money.alert' && a.resultStatus === 'ok')).toBe(true)
  })

  it('чужому пользователю письма компании не уходят', async () => {
    await spend(1)
    await runFinanceSweep()
    expect(mail.sent.some((m) => m.to === 'stranger@example.com')).toBe(false)
  })

  it('почта не настроена — тревога не теряется: остаётся в журнале с причиной', async () => {
    await spend(1)
    mail.ok = false
    await runFinanceSweep()
    const undelivered = (await journal()).filter((a) => a.action === 'money.alert' && a.resultStatus === 'skipped')
    expect(undelivered).toHaveLength(1)
    expect(undelivered[0].error).toContain('почта')
  })

  it('сухой прогон считает, но не пишет владельцу', async () => {
    await spend(1)
    await setLoopDryRun('finance', true)
    await runFinanceSweep()
    expect(mail.sent).toHaveLength(0)
    const [act] = await journal()
    expect(act.resultStatus).toBe('dry-run')
    await setLoopDryRun('finance', false)
  })
})

describe('летописец', () => {
  it('день без событий не рассылается — тишина не новость', async () => {
    const res = await runChronicleSweep()
    expect(res.sent).toBe(0)
    expect(mail.sent).toHaveLength(0)
    const [act] = await journal()
    expect(act.resultStatus).toBe('skipped')
  })

  it('был день с событиями — сводка уходит владельцу', async () => {
    // Летописец отчитывается о ЗАВЕРШЁННОМ дне — событие кладём вчерашним числом.
    await db.insert(agentActions).values({ loop: 'selfgen', action: 'list.draft', resultStatus: 'ok', signal: {}, decision: {}, occurredAt: sql`now() - interval '1 day'` })
    const res = await runChronicleSweep()
    expect(res.sent).toBe(1)
    expect(mail.sent[0].subject).toContain('день компании')
  })
})
