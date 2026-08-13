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
const { refreshChangelog } = await import('@/features/changelog/service')
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

  it('changelog: включён сухой прогон → в сеть не идём', async () => {
    // Петля включается настройками, иначе проверялся бы выключенный тумблер, а не
    // сухой прогон (находка A1 линзы 06 — эта петля политику не читала вовсе).
    //
    // Различает ветки именно ЗАПИСЬ В ЖУРНАЛЕ, а не added: без сухого прогона поход
    // в сеть за несуществующим репозиторием вернул бы пусто, и петля вышла бы раньше
    // журнала — то есть запись 'dry-run' не появилась бы вовсе.
    await saveSettings({ 'changelog.enabled': 'true', 'changelog.repo': 'owner/name' })
    await setLoopDryRun('changelog', true)
    const res = await refreshChangelog()
    expect(res).toEqual({ added: 0, skipped: 'dry run' })
    expect((await journalFor('changelog'))[0]?.resultStatus).toBe('dry-run')
  })
})

/**
 * УЗДА НА ПОКРЫТИЕ. Тесты выше перечисляют петли руками, и ровно поэтому `changelog`
 * проехал: он появился позже, в список его никто не добавил, а `describe` обещает
 * «каждая петля». Контракт пауз (`loops-contract`) устроен иначе — он идёт по реестру,
 * и мимо него петлю не пронести.
 *
 * Здесь предметную проверку по реестру не построить: у каждой петли своё «ничего не
 * сделано» (добычи нет / проб нет / писем нет), одной формулой это не выражается.
 * Поэтому реестр сверяется со списком покрытых, а непокрытые перечислены явно и с
 * датой. Новая петля не попадёт ни туда, ни туда — и тест покраснеет, требуя
 * предметной проверки. Долг при этом виден списком, а не растворён в умолчании.
 */
describe('покрытие контракта', () => {
  const ПОКРЫТЫ = new Set(['triples', 'linkcheck', 'digest', 'changelog'])
  // Долг на 13.08.2026: у этих петель сухой прогон читается (проверено grep по
  // loopPolicy/dryRun), но предметного теста нет. Список можно только СОКРАЩАТЬ.
  const ДОЛГ = new Set(['gardener', 'selfgen', 'feedpull', 'finance', 'chronicle', 'aiwatch', 'partners'])

  it('каждая петля реестра либо покрыта, либо числится в долге', async () => {
    const { AUTONOMOUS_LOOPS } = await import('@/shared/agents/policy')
    const нет = AUTONOMOUS_LOOPS.filter((l) => !ПОКРЫТЫ.has(l) && !ДОЛГ.has(l))
    expect(нет, `петли без проверки сухого прогона: ${нет.join(', ')}`).toEqual([])
  })

  it('в списках нет петель, которых больше нет в реестре', async () => {
    const { AUTONOMOUS_LOOPS } = await import('@/shared/agents/policy')
    const реестр = new Set<string>(AUTONOMOUS_LOOPS)
    const лишние = [...ПОКРЫТЫ, ...ДОЛГ].filter((l) => !реестр.has(l))
    expect(лишние, `петля пропала из реестра, а в списке осталась: ${лишние.join(', ')}`).toEqual([])
  })
})
