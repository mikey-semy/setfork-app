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
/**
 * ⚠️ «ЧАС НАЗАД» — ЭТО НЕ «СЕГОДНЯ». Тесты про счёт за календарный день ставили вызовы
 * относительно ТЕКУЩЕГО момента (`minutesAgo`), а день база отсчитывает от своей полуночи
 * (`date_trunc('day', now())`). В первый час суток «час назад» попадает во ВЧЕРА, и счёт
 * дня выходил нулевым: 03.09.2026 в 00:27 UTC прогон падал на `{calls: 0, failed: 0}`
 * вместо `{calls: 2, failed: 1}` — и падал бы каждую ночь в этот час, на любой ветке.
 *
 * Поэтому у дня своя привязка: `inDay` ставит вызов ВНУТРЬ нужных суток, отсчитывая от их
 * начала, а не от «сейчас». `minutesAgo` остаётся там, где смысл именно в свежести
 * (серия отказов, окно молчания) — там час дня ни на что не влияет.
 */
const call = async (
  outcome: string,
  opts: { minutesAgo?: number; inDay?: number; feature?: string; model?: string; refType?: string; actor?: 'user' | 'company' } = {},
) => {
  const [row] = await db
    .insert(aiUsage)
    .values({ feature: (opts.feature ?? 'refine') as 'refine', model: opts.model ?? 'openrouter/auto', outcome, actor: opts.actor ?? 'company', ...(opts.refType ? { refType: opts.refType } : {}) } as never)
    .returning({ id: aiUsage.id })
  if (opts.inDay !== undefined) {
    // Полчаса после полуночи ТЕХ суток: внутри окна `callsOnDay` при любом часе прогона.
    await db.execute(
      sql`update ${aiUsage} set created_at = date_trunc('day', now()) - (${opts.inDay}::int * interval '1 day') + interval '30 minutes' where id = ${row.id}`,
    )
  } else if (opts.minutesAgo) {
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

  /**
   * ВОСЕМЬ ПРОХОДОВ РАЗОМ — ПИСЬМО ВСЁ РАВНО ОДНО.
   *
   * Двух гонщиков мало: заявка занимается атомарно, и чтобы дубль случился, второй должен
   * прочитать журнал ИМЕННО между вставкой первого и своей — тогда он берёт следующий номер
   * попытки, а с ним и другой ключ. Окно узкое, поэтому на двух проходах дефект показывался
   * через раз (плавающее падение coverage в CI, [1,1] вместо [0,1]), а локально не
   * воспроизводился вовсе. Восемь параллельных проходов делают попадание в окно почти
   * неизбежным — то есть проверка перестаёт зависеть от везения.
   */
  it('восемь проходов разом — письмо всё равно одно', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })

    const runs = await Promise.all(Array.from({ length: 8 }, () => runAiWatchSweep()))

    expect(runs.filter((r) => r.sent === 1)).toHaveLength(1)
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
    await call('error', { inDay: 0 })
    await call('ok', { inDay: 0 })
    await call('timeout', { inDay: 2 }) // позавчерашний — в счёт дня не идёт

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

/**
 * СЛУЖЕБНАЯ ОТМЕТКА УЧЁТА — НЕ ВЫЗОВ МОДЕЛИ.
 *
 * `council-run` пишется ПОСЛЕ работы совета с нулевыми токенами: это расход слота лимита, а
 * не обращение к каналу. Считая её успехом, сторож объявлял канал ожившим без единого
 * удачного вызова — и слал владельцу «канал восстановлен» посреди обрыва (авто-ревью #775).
 */
describe('служебные отметки не путаются с вызовами', () => {
  it('отметка учёта не считается успехом и не прерывает серию отказов', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })
    await call('ok', { refType: 'council-run' }) // «успех», за которым модель не звалась

    const state = await channelState()

    expect(state.failStreak).toBe(ERROR_STREAK_TRIP)
    expect(channelDown(state)).toBe(true)
  })

  it('настоящий успех серию прерывает', async () => {
    for (let i = 0; i < ERROR_STREAK_TRIP; i++) await call('error', { minutesAgo: 30 - i })
    await call('ok')

    expect(channelDown(await channelState())).toBe(false)
  })
})

/**
 * СВОДКА ДНЯ СЧИТАЕТ ВЫЗОВЫ КОМПАНИИ, А НЕ ВСЕ ПОДРЯД.
 *
 * Признака «кто позвал» не было, и пять неудачных генераций ЧЕЛОВЕКА читались как «компания
 * не сделала ничего»: сводка объявляла её бездельницей за чужие отказы (авто-ревью #775).
 * Признак ставит контекст исполнения петли, а не аргумент вызова.
 */
describe('день компании и чужие вызовы', () => {
  it('пользовательские вызовы в счёт дня не идут', async () => {
    const { callsOnDay } = await import('@/features/backoffice/ai-watch')
    for (let i = 0; i < 5; i++) await call('error', { inDay: 0, actor: 'user' })

    expect(await callsOnDay(0)).toEqual({ calls: 0, failed: 0 })
  })

  it('вызовы компании идут', async () => {
    const { callsOnDay } = await import('@/features/backoffice/ai-watch')
    await call('ok', { inDay: 0 })
    await call('error', { inDay: 0 })

    expect(await callsOnDay(0)).toEqual({ calls: 2, failed: 1 })
  })
})
