import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ДНЕВНОЙ ПОТОЛОК ДЕРЖИТ СЕРЕДИНУ ПАРТИИ, а не только вход в проход.
 *
 * Находка A3 линзы 06: проверка стояла один раз, перед началом. Если деньги кончались
 * на середине партии, оставшиеся списки всё равно уходили в модель — то есть потолок,
 * который «есть», пробивался ровно настолько, насколько велика партия. У самогенерации
 * это было сделано правильно, у ухода и рудника — нет.
 *
 * Проверяем поведением: бюджет отдаёт «есть» ровно один раз, дальше «кончился». Значит
 * до модели должен дойти РОВНО ОДИН список из двух.
 */
type Item = { title: string; desc: string; command: string; level: 'required'; why: string; subtasks: string[]; refs: { label: string; url: string }[] }
const item = (title: string): Item => ({ title, desc: 'что делать', command: '', level: 'required', why: '', subtasks: [], refs: [] })

const ai = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/shared/ai/generate', () => ({
  generateListRefine: vi.fn(async () => {
    ai.calls++
    return { title: 'Список', desc: '', tags: ['devops'], items: [item('Новый шаг'), item('Ещё шаг')] }
  }),
}))
vi.mock('@/shared/lib/link-health', () => ({ checkUrls: vi.fn(async () => new Map<string, string>()) }))
vi.mock('@/shared/settings/ai', async (orig) => ({ ...(await orig<Record<string, unknown>>()), isAiAvailable: vi.fn(async () => true) }))

// Кошелёк: первый спрос — деньги есть, дальше кончились. Ровно так выглядит исчерпание
// потолка на середине партии.
const деньги = vi.hoisted(() => ({ осталось: 1 }))
vi.mock('@/shared/quota', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  globalBudgetOk: vi.fn(async () => деньги.осталось-- > 0),
}))

const { agentActions, db, templates, templateVersions, steps, suggestions, users } = await import('@/shared/db')
const { runGardenerSweep } = await import('@/features/gardener/service')

/** Два публичных списка живого человека — партия, которую уход возьмёт за один проход. */
const seed = async () => {
  const [h] = await db.insert(users).values({ handle: 'bm-human', email: 'bm@example.com' }).returning({ id: users.id })
  for (const slug of ['bm-one', 'bm-two']) {
    const [t] = await db
      .insert(templates)
      .values({ ownerId: h.id, slug, title: { ru: 'Список' }, tags: ['devops'], status: 'published', visibility: 'public' })
      .returning({ id: templates.id })
    const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, authorId: h.id }).returning({ id: templateVersions.id })
    await db.insert(steps).values({ versionId: v.id, n: 1, title: { ru: 'Старый шаг' } })
    await db.update(templates).set({ currentVersion: 1 }).where(sql`${templates.id} = ${t.id}`)
  }
}

beforeEach(async () => {
  await resetTables([agentActions, suggestions, steps, templateVersions, templates, users])
  ai.calls = 0
  // Один спрос уходит на вход в проход, второй разрешает первый список, третий — уже нет.
  деньги.осталось = 2
  await seed()
})

describe('дневной потолок на середине партии', () => {
  it('деньги кончились после первого списка — второй в модель не идёт', async () => {
    await runGardenerSweep()
    expect(ai.calls, 'модель позвали больше раза при исчерпанном потолке').toBe(1)
  })
})
