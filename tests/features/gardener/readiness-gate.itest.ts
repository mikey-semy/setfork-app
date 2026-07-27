import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentActions, appSettings, db, templates, users } from '@/shared/db'
import { gateOwnDraft } from '@/features/gardener/service'
import type { ReadinessInput } from '@/shared/ai/readiness-lenses'

// Гейт готовности сквозняком, БЕЗ трат на модель: в тестовой среде ИИ-клиента нет, значит
// линзы не отвечают — и это ровно тот случай, который обязан вести себя fail-closed.
// Проверяем: настройка режима читается из БД, структурные факты считаются кодом,
// отсутствие ответов линз оставляет черновик черновиком, а решение попадает в журнал.

let ownerId = ''
let tplId = ''

const setSetting = async (key: string, value: string) => {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

const snapshot = (steps: number): ReadinessInput => ({
  title: 'Ферментация теста',
  desc: 'Как вести закваску по дням',
  tags: ['кулинария'],
  items: Array.from({ length: steps }, (_, i) => ({ title: `Шаг ${i + 1}`, desc: 'что делать' })),
})

const tpl = () => ({ id: tplId, slug: 'bread', tags: ['кулинария'], desc: { ru: 'Как вести закваску' }, status: 'draft' })
const ctx = () => ({ tenderId: ownerId, agentId: 'cook', policyVersion: 1, lang: 'ru' as const })

beforeAll(async () => {
  await db.execute(sql`truncate table ${agentActions}, ${appSettings}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db
    .insert(users)
    .values({ handle: 'gate-agent', accountType: 'agent', profession: 'Cook' })
    .returning({ id: users.id })
  ownerId = u.id
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: 'bread', title: { ru: 'Ферментация теста' }, tags: ['кулинария'], status: 'draft' })
    .returning({ id: templates.id })
  tplId = t.id
})

beforeEach(async () => {
  await db.delete(agentActions)
  await db.update(templates).set({ status: 'draft' }).where(eq(templates.id, tplId))
})

const journal = async () => db.select().from(agentActions)
const statusOf = async () => (await db.select({ s: templates.status }).from(templates).where(eq(templates.id, tplId)))[0]?.s

describe('гейт готовности', () => {
  it("режим 'off' (дефолт) — не тратит и ничего не решает", async () => {
    await setSetting('ai.readiness_mode', 'off')
    expect(await gateOwnDraft(tpl(), snapshot(8), ctx())).toBe('skipped')
    expect(await journal()).toHaveLength(0)
  })

  it('линзы не ответили (ИИ недоступен) → черновик остаётся черновиком: fail-closed', async () => {
    await setSetting('ai.readiness_mode', 'on')
    await setSetting('ai.readiness_min_steps', '5')
    expect(await gateOwnDraft(tpl(), snapshot(8), ctx())).toBe('held')
    expect(await statusOf()).toBe('draft')
    const rows = await journal()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('list.hold')
    // В журнале видно, что именно не дало пропустить — три линзы без ответа.
    expect(JSON.stringify(rows[0].decision)).toContain('ответа нет')
  })

  it('короткий список отсекается СТРУКТУРНО — линзы даже не зовутся', async () => {
    await setSetting('ai.readiness_mode', 'on')
    await setSetting('ai.readiness_min_steps', '5')
    expect(await gateOwnDraft(tpl(), snapshot(2), ctx())).toBe('held')
    const [row] = await journal()
    const d = row.decision as { blockers: string[]; lenses: string[] }
    // Структурный блокер стоит ПЕРВЫМ — он и есть причина, по которой линзы не звали.
    expect(d.blockers[0]).toBe('шагов 2 < планки 5')
    // Ни одного вердикта линзы: до них не дошло, значит и денег не потрачено.
    expect(d.lenses).toEqual([])
  })

  it('журнал пишет структурные факты как СИГНАЛ — по ним видно, что гейт смотрел', async () => {
    await setSetting('ai.readiness_mode', 'shadow')
    await gateOwnDraft(tpl(), snapshot(7), ctx())
    const [row] = await journal()
    expect(row.signal).toMatchObject({ slug: 'bread', steps: 7, deadLinks: 0, hasDesc: true, hasTags: true, duplicateSteps: 0 })
  })

  it('повторяющиеся шаги (набивка объёма) — структурный блокер', async () => {
    await setSetting('ai.readiness_mode', 'on')
    const padded: ReadinessInput = { ...snapshot(6), items: Array.from({ length: 6 }, () => ({ title: 'Помешать' })) }
    expect(await gateOwnDraft(tpl(), padded, ctx())).toBe('held')
    expect(JSON.stringify((await journal())[0].decision)).toContain('повторяющихся шагов: 6')
  })
})
