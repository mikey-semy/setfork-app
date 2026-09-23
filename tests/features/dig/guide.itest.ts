import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПРОВОДНИК КИРКИ ПО ПУНКТУ: Jev решает, запасное правило подхватывает, решение живёт в
 * `dig_guides` — на настоящей базе.
 *
 * Внешнее подменено, остальное настоящее: сеть до OpenRouter (Decisions), ключ из
 * настроек и предохранитель расхода (он ходит за остатком к провайдеру).
 */
vi.mock('@/shared/settings/ai', async (orig) => ({ ...(await orig()), getOpenRouterApiKey: async () => 'k' }))
vi.mock('@/shared/quota', async (orig) => ({ ...(await orig()), globalBudgetOk: async () => true }))

const { db, digGuides, templates, users } = await import('@/shared/db')
const { guideForItem } = await import('@/features/dig/guide')
type Roster = Parameters<typeof guideForItem>[1]

const g = (id: string, persona: string, domains: string[]) => ({ id, persona, domains }) as unknown as Roster[number]
const ROSTER: Roster = [
  g('dba', 'a database engineer. Indexes first.', ['postgresql', 'sql']),
  g('devops', 'a pragmatic DevOps/SRE expert. Reliability is a number.', ['deploy', 'ci']),
  g('hoarder', 'a resource investigator (Belbin): the scout.', ['*']),
  g('generalist', 'a well-rounded generalist. Classify first.', ['*']),
]

const choice = (id: string, confidence = 0.8) => ({
  model: 'typesafe/jev-1.13-20260917',
  answers: { guide: { type: 'choice', choice: id, probabilities: { [id]: confidence }, confidence } },
  usage: { input_tokens: 300, output_tokens: 30, cost: 0.00001 },
})
const noul = (p: number) => ({ model: 'typesafe/jev-1.13-20260917', answers: { fits: { type: 'noul', noul: p } }, usage: { input_tokens: 100, output_tokens: 10, cost: 0.000005 } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
/** Тела запросов к Decisions — по порядку. */
const asked = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string))

let tplId = ''
let userId = ''
const item = () => ({ templateId: tplId, version: 1, stepN: 3, listTitle: 'Медленное API', tags: ['devops', 'redis'], item: 'Найти медленные запросы: pg_stat_statements', userId })

beforeEach(async () => {
  await resetTables([digGuides, templates, users])
  const [u] = await db.insert(users).values({ handle: 'guide-owner' }).returning({ id: users.id })
  userId = u.id
  const [t] = await db.insert(templates).values({ ownerId: userId, slug: 'slow-api', title: { ru: 'Медленное API' } }).returning({ id: templates.id })
  tplId = t.id
})

afterEach(() => vi.restoreAllMocks())

describe('решение по пункту', () => {
  it('Jev выбирает, решение и теневой ответ о ремесле ложатся в dig_guides', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('dba', 0.83))).mockResolvedValueOnce(json(noul(0.91)))
    const r = await guideForItem(item(), ROSTER)
    expect(r?.expert.id).toBe('dba')
    await r?.shadow
    const [row] = await db.select().from(digGuides).where(eq(digGuides.templateId, tplId))
    expect(row).toMatchObject({ gnomeId: 'dba', confidence: expect.closeTo(0.83, 5), fits: expect.closeTo(0.91, 5), model: 'typesafe/jev-1.13-20260917' })
    // Разведчик — роль, а не ремесло: в вариантах его нет; второй вопрос — про ремесло выбранного.
    const [q1, q2] = asked(spy)
    expect(Object.keys(q1.questions.guide.criteria)).toEqual(['dba', 'devops', 'generalist'])
    expect(q2.questions.fits.type).toBe('noul')
    expect(q2.questions.fits.instructions).toContain('a database engineer')
  })

  it('второй вопрос по тому же пункту — из кэша, без модели', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('dba'))).mockResolvedValueOnce(json(noul(0.9)))
    await (await guideForItem(item(), ROSTER))?.shadow
    vi.restoreAllMocks()
    const spy = vi.spyOn(globalThis, 'fetch')
    const again = await guideForItem(item(), ROSTER)
    expect(again?.expert.id).toBe('dba')
    expect(spy).not.toHaveBeenCalled()
  })

  it('выбранного выключили — спрашиваем заново и перезаписываем решение', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('dba'))).mockResolvedValueOnce(json(noul(0.9)))
    await (await guideForItem(item(), ROSTER))?.shadow
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('devops'))).mockResolvedValueOnce(json(noul(0.4)))
    const r = await guideForItem(item(), ROSTER.filter((e) => e.id !== 'dba'))
    await r?.shadow
    expect(r?.expert.id).toBe('devops')
    const rows = await db.select().from(digGuides).where(eq(digGuides.templateId, tplId))
    expect(rows.map((x) => x.gnomeId)).toEqual(['devops'])
  })
})

describe('кэш знает, о чём спрашивал', () => {
  it('ростер поменялся — пункт переспрашивается, а не держится за старого', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('dba'))).mockResolvedValueOnce(json(noul(0.9)))
    await (await guideForItem(item(), ROSTER))?.shadow
    vi.restoreAllMocks()
    // Админ переписал персону DevOps: вопрос уже другой.
    const edited = ROSTER.map((e) => (e.id === 'devops' ? g('devops', 'a database-savvy SRE. Owns Postgres in prod.', ['postgresql', 'deploy']) : e))
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('devops'))).mockResolvedValueOnce(json(noul(0.7)))
    const r = await guideForItem(item(), edited)
    await r?.shadow
    expect(spy).toHaveBeenCalled()
    expect(r?.expert.id).toBe('devops')
    const rows = await db.select().from(digGuides).where(eq(digGuides.templateId, tplId))
    expect(rows.map((x) => x.gnomeId)).toEqual(['devops'])
  })

  it('теневой ответ однажды не пришёл — при следующем визите спрашивается снова', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('dba'))).mockRejectedValueOnce(new TypeError('fetch failed'))
    await (await guideForItem(item(), ROSTER))?.shadow
    vi.restoreAllMocks()
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(noul(0.77)))
    const r = await guideForItem(item(), ROSTER)
    await r?.shadow
    // Решение из кэша (вопроса choice нет), а тень — заново.
    expect(spy).toHaveBeenCalledTimes(1)
    const [row] = await db.select().from(digGuides).where(eq(digGuides.templateId, tplId))
    expect(row.fits).toBeCloseTo(0.77, 5)
  })
})

describe('гонка двух первых вопросов по одному пункту', () => {
  it('оба получают одного победителя, строка одна, и тень лежит у него', async () => {
    // Первый запрос выберет dba, второй — devops; тени у обоих «да». Ответы на выбор
    // придерживаются, пока не придут ОБА запроса: так оба гарантированно прошли мимо пустого
    // кэша, и гонка воспроизводится каждый раз, а не когда повезёт.
    let asked = 0
    let both: () => void = () => {}
    const bothAsked = new Promise<void>((r) => (both = r))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      if (body.questions.fits) return json(noul(0.9))
      const n = ++asked
      if (n === 2) both()
      await bothAsked
      return json(choice(n === 1 ? 'dba' : 'devops'))
    })
    const [a, b] = await Promise.all([guideForItem(item(), ROSTER), guideForItem(item(), ROSTER)])
    await Promise.all([a?.shadow, b?.shadow])
    expect(asked).toBe(2)
    const rows = await db.select().from(digGuides).where(eq(digGuides.templateId, tplId))
    expect(rows).toHaveLength(1)
    expect(a?.expert.id).toBe(rows[0].gnomeId)
    expect(b?.expert.id).toBe(rows[0].gnomeId)
    expect(rows[0].fits).toBeCloseTo(0.9, 5)
  })

  it('теневой ответ чужого мастера в строку не ложится', async () => {
    // Строку перевыбрали, пока шёл теневой вопрос про dba: его ответ уже не про неё.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      if (body.questions.fits) {
        await gate
        return json(noul(0.9))
      }
      return json(choice('dba'))
    })
    const r = await guideForItem(item(), ROSTER)
    await db.update(digGuides).set({ gnomeId: 'devops' }).where(eq(digGuides.templateId, tplId))
    release()
    await r?.shadow
    const [row] = await db.select().from(digGuides).where(eq(digGuides.templateId, tplId))
    expect(row).toMatchObject({ gnomeId: 'devops', fits: null })
  })
})

describe('сбой — null, и в выборку калибровки ничего не попадает', () => {
  it('модель не ответила — null, строки нет', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { message: 'down' } }, 503))
    expect(await guideForItem(item(), ROSTER)).toBeNull()
    expect(await db.select().from(digGuides)).toEqual([])
  })

  it('выбор вне ростера — null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(choice('chef')))
    expect(await guideForItem(item(), ROSTER)).toBeNull()
  })

  it('выбирать не из кого — модель не зовут', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(await guideForItem(item(), ROSTER.filter((e) => e.id === 'generalist' || e.id === 'hoarder'))).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('теневой вопрос упал — решение остаётся, fits пустой', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(choice('dba'))).mockRejectedValueOnce(new TypeError('fetch failed'))
    const r = await guideForItem(item(), ROSTER)
    await r?.shadow
    const [row] = await db.select().from(digGuides)
    expect(row).toMatchObject({ gnomeId: 'dba', fits: null })
  })
})
