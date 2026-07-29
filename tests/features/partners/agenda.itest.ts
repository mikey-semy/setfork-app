import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Петля партнёров на реальной БД. Проверяем не формулировки, а поведение: что повестка растёт
// из ЧИСЕЛ, что решение человека неприкосновенно и что закрытый сигнал закрывает пункт.
const { agendaItems, agentActions, agentLoops, councilExperts, db, templates, users } = await import('@/shared/db')
const { runPartnersSweep } = await import('@/features/partners/service')
const { approvedDomains } = await import('@/shared/agents/agenda-db')
const { setLoopDryRun } = await import('@/shared/agents/policy')

let ownerId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${agendaItems}, ${agentActions}, ${agentLoops}, ${councilExperts}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'partners-owner' }).returning({ id: users.id })
  ownerId = u.id
  // Один профильный мастер с пустой темой — этого достаточно, чтобы появился повод расти.
  await db.insert(councilExperts).values({
    id: 'cook-x',
    nameEn: 'Cook',
    nameRu: 'Повар',
    persona: 'a cook',
    code: 'C',
    lens: 'cooking',
    domains: ['кулинария'],
    model: '',
    avatar: 'cook',
    sort: 1,
  })
})

beforeEach(async () => {
  await db.delete(agendaItems)
  await db.delete(agentActions)
  await db.delete(agentLoops)
  // Ростер приводим к ОДНОМУ мастеру перед каждым тестом. Иначе при полном штате (20 доменов)
  // сигналов больше, чем срез повестки, и наша «кулинария» законно не попадает в двенадцать —
  // тест падал бы не на поведении, а на длине списка. В CI это и случилось.
  await db.delete(councilExperts)
  await db.insert(councilExperts).values({
    id: 'cook-x', nameEn: 'Cook', nameRu: 'Повар', persona: 'a cook', code: 'C',
    lens: 'cooking', domains: ['кулинария'], model: '', avatar: 'cook', sort: 1,
  })
})

const items = async () => db.select().from(agendaItems)

describe('повестка растёт из чисел', () => {
  it('пустая тема мастера превращается в пункт с честным «почему»', async () => {
    const res = await runPartnersSweep()
    expect(res.proposed).toBeGreaterThan(0)
    const rows = await items()
    const cook = rows.find((r) => r.domain === 'кулинария')
    expect(cook, 'пустая тема мастера не попала в повестку').toBeDefined()
    // Числа, а не формулировка: «списков 0 при пороге 5» проверяемо.
    expect(cook!.why).toMatchObject({ lists: 0 })
    expect(cook!.status).toBe('proposed')
  })

  it('повторный проход дублей не плодит — обновляет тот же пункт', async () => {
    // ПЕРВЫЙ проход досевает штат (getRoster дозаполняет ростер), поэтому второй видит уже
    // двадцать доменов вместо одного — сравнивать первый со вторым значит сравнивать разные
    // миры. Прогреваем дважды и сравниваем УСТОЯВШИЕСЯ проходы.
    await runPartnersSweep()
    await runPartnersSweep()
    const before = (await items()).length
    const res = await runPartnersSweep()
    expect((await items()).length).toBe(before)
    expect(res.proposed).toBe(0)
    expect(res.updated).toBeGreaterThan(0)
  })

  it('каждый проход виден в журнале компании', async () => {
    await runPartnersSweep()
    const acts = await db.select().from(agentActions)
    expect(acts.some((a) => a.loop === 'partners' && a.action === 'agenda.review')).toBe(true)
  })

  it('сухой прогон решение считает, но повестку не трогает', async () => {
    await setLoopDryRun('partners', true)
    const res = await runPartnersSweep()
    expect(res.proposed).toBe(0)
    expect(await items()).toHaveLength(0)
    const [act] = await db.select().from(agentActions)
    expect(act.resultStatus).toBe('dry-run')
    await setLoopDryRun('partners', false)
  })
})

describe('решение человека неприкосновенно', () => {
  it('отклонённый пункт петля больше не предлагает', async () => {
    await runPartnersSweep()
    const [item] = await items()
    await db.update(agendaItems).set({ status: 'dismissed', decidedBy: ownerId, decidedAt: new Date() }).where(eq(agendaItems.id, item.id))

    await runPartnersSweep()

    const [again] = await db.select().from(agendaItems).where(eq(agendaItems.id, item.id))
    expect(again.status, 'петля воскресила отклонённое — это спор с гендиректором').toBe('dismissed')
  })

  it('одобренная тема доезжает до производства', async () => {
    await runPartnersSweep()
    const rows = await items()
    const cook = rows.find((r) => r.domain === 'кулинария')
    expect(cook, 'пункт по теме мастера не попал в повестку').toBeDefined()
    expect(await approvedDomains()).toEqual([])

    await db.update(agendaItems).set({ status: 'approved', decidedBy: ownerId, decidedAt: new Date() }).where(eq(agendaItems.id, cook!.id))

    expect(await approvedDomains()).toContain('кулинария')
  })
})

describe('исчезнувший сигнал закрывает пункт', () => {
  it('тема наполнилась — пункт уходит в «сделано», а не висит вечно', async () => {
    await runPartnersSweep()
    expect((await items()).some((r) => r.domain === 'кулинария' && r.status === 'proposed')).toBe(true)

    // Пять опубликованных списков по теме = порог покрытия достигнут.
    for (let i = 0; i < 5; i++) {
      await db.insert(templates).values({
        ownerId,
        slug: `cook-${i}`,
        title: { ru: `Рецепт ${i}` },
        tags: ['кулинария'],
        status: 'published',
        visibility: 'public',
        moderation: 'active',
      })
    }

    await runPartnersSweep()

    const [cook] = await db.select().from(agendaItems).where(eq(agendaItems.domain, 'кулинария'))
    expect(cook.status, 'закрытый сигнал оставил пункт в повестке — она показывает архив намерений').toBe('done')
  })
})

describe('у одобренной работы есть хозяин', () => {
  it('одобрение назначает профильного мастера — «имя, а не отдел»', async () => {
    // Соседний тест наполняет тему пятью списками и не убирает за собой — без этой чистки
    // покрытие уже достигнуто и повод для пункта исчезает. Изоляция теста, а не логика.
    await db.delete(templates)
    await runPartnersSweep()
    const [item] = (await items()).filter((r) => r.domain === 'кулинария')
    expect(item.ownerExpertId, 'до одобрения хозяина нет — работы ещё нет').toBeNull()

    // Так делает действие админки: одобрение + назначение профильного мастера по теме.
    const { getRoster } = await import('@/shared/ai/roster')
    const { tenderForTags } = await import('@/shared/ai/gnome-account')
    const tender = await tenderForTags([item.domain], await getRoster())
    await db
      .update(agendaItems)
      .set({ status: 'approved', ownerExpertId: tender?.expert.id ?? null, decidedBy: ownerId, decidedAt: new Date() })
      .where(eq(agendaItems.id, item.id))

    const [after] = await db.select().from(agendaItems).where(eq(agendaItems.id, item.id))
    expect(after.ownerExpertId, 'у одобренной темы не появилось ответственного').toBe('cook-x')
  })
})
