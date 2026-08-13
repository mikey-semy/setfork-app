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

  // Обрыв длится, петли продолжают ходить, отказы копятся — эпизод от этого не становится
  // новым. Пока имя эпизода бралось из хвоста фиксированной длины, каждый новый отказ
  // сдвигал бы его и приносил владельцу письмо каждый час.
  it('обрыв длится и отказы копятся — письмо всё равно одно', async () => {
    await call('ok', { minutesAgo: 600 })
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 100 - i })
    await runAiWatchSweep()

    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error') // канал всё ещё лежит
    const again = await runAiWatchSweep()

    expect(again.verdict).toBe('down')
    expect(again.sent).toBe(0)
    expect(mail.sent).toHaveLength(1)
  })

  // Отказы могут просто состариться и выпасть из окна свежести, а звать модель с тех пор
  // было некому. Пустой хвост — не доказательство, что канал ожил.
  it('без успешного вызова «восстановлен» не объявляем', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })
    await runAiWatchSweep()
    // Отказы уехали за окно свежести, новых вызовов не было.
    await db.execute(sql`update ${aiUsage} set created_at = now() - interval '30 hours'`)

    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('ok')
    expect(mail.sent).toHaveLength(1) // только первая тревога
  })

  // Второй обрыв в те же сутки — отдельное событие. Пока ключом был календарный день,
  // о нём владелец не узнавал до полуночи.
  it('канал лёг, ожил и лёг снова в те же сутки — две тревоги, а не одна', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 300 - i })
    await runAiWatchSweep()
    await call('ok') // успешный вызов ПОСЛЕ тревоги — это и есть доказательство
    await runAiWatchSweep() // «восстановлен»
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error') // второй обрыв — ПОСЛЕ удачного вызова

    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('down')
    expect(mail.sent.map((m) => m.subject)).toEqual([
      expect.stringContaining('не отвечает'),
      expect.stringContaining('восстановлен'),
      expect.stringContaining('не отвечает'),
    ])
  })

  it('после тревоги канал вернулся — говорим и об этом', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })
    await runAiWatchSweep()
    await call('ok') // прошёл ПОСЛЕ тревоги: раньше неё он ничего не доказывает

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

  // Недоставленная тревога тревогой не была: иначе владелец однажды получит «канал
  // восстановлен» без предшествующего «канал лёг» — сообщение, которое непонятно как читать.
  // Заявка на попытку занимается до отправки, поэтому одновременные проходы (второй
  // инстанс, перезапуск) не пришлют одно письмо дважды.
  it('два прохода разом — письмо одно', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })

    const [a, b] = await Promise.all([runAiWatchSweep(), runAiWatchSweep()])

    expect([a.sent, b.sent].sort()).toEqual([0, 1])
    expect(mail.sent).toHaveLength(1)
  })

  it('тревога не дошла — «восстановлен» потом не шлём', async () => {
    await db.delete(users) // адресата нет: письмо уйти не может
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })
    const alarm = await runAiWatchSweep()
    expect(alarm.verdict).toBe('down')
    expect(alarm.sent).toBe(0)

    await seedOwner() // почту починили
    await call('ok', { minutesAgo: 1 })
    const res = await runAiWatchSweep()

    expect(res.verdict).toBe('ok')
    expect(mail.sent).toHaveLength(0)
  })

  it('счёт за календарный день отделяет неудачи от успешных вызовов', async () => {
    const { callsOnDay } = await import('@/features/backoffice/ai-watch')
    await call('error', { minutesAgo: 5 })
    await call('ok', { minutesAgo: 5 })
    await call('timeout', { minutesAgo: 60 * 30 }) // позавчерашний — в счёт дня не идёт

    const today = await callsOnDay(0)

    expect(today.calls).toBe(2)
    expect(today.failed).toBe(1)
  })

  // Летописец судит по КАРТИНЕ дня: иначе одна упавшая генерация человека объявляла бы
  // поломку компании, а одна успешная — будила бы нулевую сводку в тихий день.
  it('поломка дня — это когда не прошёл ни один вызов, а не «был хоть один отказ»', async () => {
    const { channelBrokenAllDay } = await import('@/features/backoffice/ai-watch')

    expect(channelBrokenAllDay({ calls: ERROR_STREAK_TRIP, failed: ERROR_STREAK_TRIP })).toBe(true)
    expect(channelBrokenAllDay({ calls: 10, failed: 1 })).toBe(false) // человек разок не дождался
    expect(channelBrokenAllDay({ calls: 2, failed: 2 })).toBe(false) // мало вызовов — это не картина
    expect(channelBrokenAllDay({ calls: 0, failed: 0 })).toBe(false) // никто не звал
  })

  // Без окна свежести серия «застывает»: упали последние пять вызовов, трафик прекратился —
  // и канал числился бы лежащим бесконечно, хотя проверять это стало нечем.
  it('вчерашние отказы каналом не считаются: проверять уже нечего', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 60 * 26 + i })

    const state = await channelState()

    expect(state.failStreak).toBe(0)
    expect(channelDown(state)).toBe(false)
  })

  it('эмбеддинги в счёт не идут: они ходят своим маршрутом и в инциденте 12.08 проходили', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 20 - i })
    await call('ok', { minutesAgo: 1, feature: 'embed', model: 'openai/text-embedding-3-small' })

    const state = await channelState()

    expect(state.failStreak).toBe(ERROR_STREAK_TRIP)
    expect(channelDown(state)).toBe(true)
  })
})
