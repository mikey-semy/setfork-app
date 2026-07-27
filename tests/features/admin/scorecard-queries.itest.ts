import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, generationCandidates, generationDrafts, generationMessages, generations, templates, users } from '@/shared/db'
import { getDomainScorecards } from '@/features/admin/scorecard-queries'

// Скоркарт по домену собирается из двух источников: журнал генераций (приёмка) и сохранённые
// черновики совета (многогранность). Проверяем на реальной БД главное свойство — что домен
// берётся из ТЕГОВ ПРИНЯТОГО списка (результат, а не запись в ростере) и что пара без данных
// честно остаётся «нет оснований», а не получает средний балл по гному.

let userId = ''

const card = (all: Awaited<ReturnType<typeof getDomainScorecards>>, gnome: string, domain: string) =>
  all.find((c) => c.gnomeId === gnome && c.domain === domain)

beforeAll(async () => {
  await db.execute(sql`truncate table ${generationDrafts}, ${generationCandidates}, ${generationMessages}, ${generations}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'sc-owner' }).returning({ id: users.id })
  userId = u.id
})

beforeEach(async () => {
  await db.delete(generationDrafts)
  await db.delete(generationCandidates)
  await db.delete(generationMessages)
  await db.delete(generations)
  await db.delete(templates)
})

/** Виток: два черновика, финальный список, при accepted — принятый список с тегами. */
const seedRun = async (opts: { tags?: string[]; accepted: boolean; who: [string, string] }) => {
  let tplId: string | null = null
  if (opts.accepted) {
    const [tpl] = await db
      .insert(templates)
      .values({ ownerId: userId, slug: `list-${Math.abs(opts.tags?.join('').length ?? 0)}-${opts.who[0]}`, title: { ru: 'Список' }, tags: opts.tags ?? [] })
      .returning({ id: templates.id })
    tplId = tpl.id
  }
  const [gen] = await db
    .insert(generations)
    .values({ userId, query: 'тема', chosenTemplateId: tplId })
    .returning({ id: generations.id })
  await db.insert(generationMessages).values(opts.who.map((w) => ({ generationId: gen.id, kind: 'draft', who: w, text: 'набрасывает…' })))
  await db.insert(generationCandidates).values({
    generationId: gen.id,
    idx: 1,
    title: 'Финал',
    summary: '',
    items: [{ title: 'Проверить бэкапы базы', desc: '', command: '', subtasks: [] }],
    provenance: {},
  })
  await db.insert(generationDrafts).values([
    { generationId: gen.id, idx: 1, letter: 'A', who: opts.who[0], text: '1. Проверить бэкапы базы\n2. Сменить ключи доступа' },
    { generationId: gen.id, idx: 1, letter: 'B', who: opts.who[1], text: '1. Настроить алерты диска\n2. Обновить пакеты системы' },
  ])
  return gen.id
}

describe('скоркарт по домену', () => {
  it('домен берётся из тегов ПРИНЯТОГО списка', async () => {
    await seedRun({ tags: ['devops'], accepted: true, who: ['coder', 'cook'] })
    const all = await getDomainScorecards()
    expect(card(all, 'coder', 'devops')?.axes.attempts).toBe(1)
    expect(card(all, 'cook', 'devops')?.axes.attempts).toBe(1)
  })

  it('кредит приёмки делится между давшими черновик (Σ 1/N)', async () => {
    await seedRun({ tags: ['devops'], accepted: true, who: ['coder', 'cook'] })
    expect(card(await getDomainScorecards(), 'coder', 'devops')?.axes.acceptedShare).toBeCloseTo(0.5)
  })

  it('непринятая генерация домена не даёт — попытка без ремесла', async () => {
    await seedRun({ accepted: false, who: ['coder', 'cook'] })
    const all = await getDomainScorecards()
    expect(card(all, 'coder', '(no-domain)')?.axes.attempts).toBe(1)
    expect(card(all, 'coder', '(no-domain)')?.axes.acceptedShare).toBe(0)
  })

  it('уникальные грани и доехавшие считаются по сохранённым черновикам', async () => {
    await seedRun({ tags: ['devops'], accepted: true, who: ['coder', 'cook'] })
    const a = card(await getDomainScorecards(), 'coder', 'devops')!.axes
    // У A уникальны обе строки; в финал попала одна («проверить бэкапы базы»).
    expect(a.uniqueFacets).toBeGreaterThan(0)
    expect(a.deliveredFacets).toBeGreaterThan(0)
    expect(a.facetRuns).toBe(1)
  })

  it('заявленное в ростере ремесло без данных — «нет оснований», а не средний балл', async () => {
    const all = await getDomainScorecards()
    const empty = all.filter((c) => c.card.verdict === 'no-evidence')
    expect(empty.length).toBeGreaterThan(0)
    for (const c of empty) {
      expect(c.card.acceptance).toBeNull()
      expect(c.card.facetDelivery).toBeNull()
    }
  })

  it('одна ось наполнена, вторая пуста → ранжировать нельзя', async () => {
    // Черновики совета есть, а принятия нет → приёмка нулевая по домену, но грани посчитаны.
    await seedRun({ accepted: false, who: ['coder', 'cook'] })
    const c = card(await getDomainScorecards(), 'coder', '(no-domain)')!
    expect(['one-axis-only', 'thin']).toContain(c.card.verdict)
  })

  it('список с двумя тегами даёт вклад в оба ремесла', async () => {
    await seedRun({ tags: ['devops', 'linux'], accepted: true, who: ['coder', 'cook'] })
    const all = await getDomainScorecards()
    expect(card(all, 'coder', 'devops')?.axes.attempts).toBe(1)
    expect(card(all, 'coder', 'linux')?.axes.attempts).toBe(1)
  })
})
