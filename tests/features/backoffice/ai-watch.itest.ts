import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// СТОРОЖ КАНАЛА на реальной БД. Проверяем не текст письма, а поведение: когда он говорит,
// когда молчит и почему не повторяется. Повод — два инцидента, в которых провайдер лежал
// сутки и неделю, а сигнала не было ни одного.
const mail = vi.hoisted(() => ({ sent: [] as { subject: string; body: string }[] }))
vi.mock('@/shared/email/mailer', () => ({
  sendMail: vi.fn(async ({ subject, body }: { subject: string; body: string }) => {
    mail.sent.push({ subject, body })
    return true
  }),
}))

// Адресат тревоги — владелец инстанса, а он определяется ником из ADMIN_HANDLES.
// Ставим ДО импорта сервиса: письмо без адресата не отправится, и тест проверял бы
// не сторожа, а собственную забывчивость.
process.env.ADMIN_HANDLES = 'miki'

const { agentActions, aiUsage, db, users } = await import('@/shared/db')
const { runAiWatchSweep } = await import('@/features/backoffice/service')
const { channelDown, channelState } = await import('@/features/backoffice/ai-watch')
const { ERROR_STREAK_TRIP } = await import('@/shared/agents/canary')

/** Вызов модели в журнале. Порядок задаётся сдвигом времени: считаем именно «подряд с конца». */
const call = async (outcome: string, opts: { minutesAgo?: number; feature?: string; model?: string } = {}) => {
  const [row] = await db
    .insert(aiUsage)
    .values({ feature: (opts.feature ?? 'refine') as 'refine', model: opts.model ?? 'openrouter/auto', outcome })
    .returning({ id: aiUsage.id })
  if (opts.minutesAgo) {
    await db.execute(sql`update ${aiUsage} set created_at = now() - (${opts.minutesAgo}::int * interval '1 minute') where id = ${row.id}`)
  }
}

/** Владелец с почтой: без адресата сторож честно отчитается «некому писать». */
const seedOwner = async () => {
  await db.insert(users).values({ handle: 'miki', email: 'owner@example.com' })
}

beforeEach(async () => {
  mail.sent = []
  await resetTables([agentActions, aiUsage, users])
  await seedOwner()
})

afterEach(async () => {
  await resetTables([agentActions, aiUsage, users])
})

describe('сторож канала к модели', () => {
  it('серия отказов — письмо владельцу и запись в журнале', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: ERROR_STREAK_TRIP - i })

    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('down')
    expect(res.sent).toBe(1)
    expect(mail.sent[0].subject).toContain('не отвечает')
    const rows = await db.select().from(agentActions)
    expect(rows.map((r) => r.action)).toContain('ai.down')
  })

  it('успешный вызов обрывает серию — молчим', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 10 + i })
    await call('ok', { minutesAgo: 1 })

    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('ok')
    expect(mail.sent).toHaveLength(0)
  })

  it('вторая проверка за те же сутки не шлёт письмо повторно', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: ERROR_STREAK_TRIP - i })
    await runAiWatchSweep()

    const again = await runAiWatchSweep()

    expect(again.sent).toBe(0)
    expect(mail.sent).toHaveLength(1)
  })

  it('после тревоги канал вернулся — говорим и об этом', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })
    await runAiWatchSweep()
    await call('ok', { minutesAgo: 1 })

    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('recovered')
    expect(mail.sent).toHaveLength(2)
    expect(mail.sent[1].subject).toContain('восстановлен')
  })

  it('без тревоги о возвращении не рапортуем: поздравлять не с чем', async () => {
    await call('ok', { minutesAgo: 1 })

    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('ok')
    expect(mail.sent).toHaveLength(0)
  })

  it('эмбеддинги в счёт не идут: они ходят своим маршрутом и в инциденте 12.08 проходили', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 20 - i })
    await call('ok', { minutesAgo: 1, feature: 'embed', model: 'openai/text-embedding-3-small' })

    const state = await channelState()

    expect(state.failStreak).toBe(ERROR_STREAK_TRIP)
    expect(channelDown(state)).toBe(true)
  })
})
