import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// РОСТ ЖИВОГО СПИСКА на реальной БД. Модель замокана: проверяем не её текст, а поведение —
// что без новостей мы НЕ платим за вызов, что материал списывается со ссылкой на список, что
// появляется новая версия и что в журнале это «рост», а не «устоялся» (иначе тихая неделя
// уводила бы ленту в расхождение форком).
type Item = { title: string; desc: string; command: string; level: 'required'; why: string; subtasks: string[]; refs: { label: string; url: string }[] }
const item = (title: string, desc: string, refs: { label: string; url: string }[] = []): Item => ({ title, desc, command: '', level: 'required', why: '', subtasks: [], refs })
const ai = vi.hoisted(() => ({ calls: [] as string[], reply: null as null | { title: string; desc: string; tags: string[]; items: unknown[] } }))
vi.mock('@/shared/ai/generate', () => ({
  generateListRefine: vi.fn(async (_current: unknown, instruction: string) => {
    ai.calls.push(instruction)
    return ai.reply
  }),
}))

const { agentActions, db, feedItems, feedSources, templates, templateVersions, users } = await import('@/shared/db')
const { growLiving } = await import('@/features/gardener/service')

let ownerId = ''
let tplId = ''
let sourceId = ''

const current = () => ({
  title: 'Что происходит в DevOps',
  desc: 'Лента изменений по инструментам',
  tags: ['devops'],
  items: [item('Старый пункт', 'что делать')],
})
const tpl = () => ({ id: tplId, slug: 'devops-feed', tags: ['devops'] })
const ctx = () => ({ tenderId: ownerId, agentId: 'coder', policyVersion: 1 })

const addItem = async (title: string, url: string, tags = ['devops']) => {
  const [row] = await db
    .insert(feedItems)
    .values({ sourceId, key: url, url, title, hint: 'кратко', tags, publishedAt: new Date() })
    .returning({ id: feedItems.id })
  return row.id
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${feedItems}, ${feedSources}, ${agentActions}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'living-agent', accountType: 'agent' }).returning({ id: users.id })
  ownerId = u.id
  const [s] = await db.insert(feedSources).values({ url: 'https://a.example/rss', tags: ['devops'] }).returning({ id: feedSources.id })
  sourceId = s.id
})

beforeEach(async () => {
  await db.delete(feedItems)
  await db.delete(agentActions)
  await db.delete(templates)
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: 'devops-feed', title: { ru: 'Что происходит в DevOps' }, tags: ['devops'], living: true, status: 'draft' })
    .returning({ id: templates.id })
  tplId = t.id
  ai.calls = []
  ai.reply = {
    title: 'Что происходит в DevOps',
    desc: 'Лента изменений',
    tags: ['devops'],
    items: [item('Новое: перейти на v2', '2026-07-28 что сделать', [{ label: 'a.example', url: 'https://a.example/v2' }]), item('Старый пункт', 'что делать')],
  }
})

const journal = async () => db.select().from(agentActions)

describe('рост живого списка', () => {
  it('нет новостей — модель НЕ зовём и в журнал не пишем рост', async () => {
    const res = await growLiving(tpl(), current(), 'ru', 'procedure', ctx())
    expect(res.result).toBe('nothing-new')
    // Главное: тишина ничего не стоит. Платный вызов на «нет новостей» был бы холостым ходом.
    expect(ai.calls).toHaveLength(0)
    expect(await journal()).toHaveLength(0)
  })

  it('есть новость — версия добавлена, материал списан на этот список, в журнале «рост»', async () => {
    const id = await addItem('Вышел релиз v2', 'https://a.example/v2')

    const res = await growLiving(tpl(), current(), 'ru', 'procedure', ctx())

    expect(res.result).toBe('grown')
    expect(res.snapshot?.items.length).toBeGreaterThan(0)
    // Версия списка выросла: история — это и есть архив ленты.
    const vers = await db.select().from(templateVersions).where(eq(templateVersions.templateId, tplId))
    expect(vers.length).toBeGreaterThanOrEqual(1)
    // Материал помечен использованным И связан с этим списком: по паре видно, что выросло.
    const [row] = await db.select().from(feedItems).where(eq(feedItems.id, id))
    expect(row.usedAt).not.toBeNull()
    expect(row.usedTemplateId).toBe(tplId)
    const acts = await journal()
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ action: 'list.grow', resultStatus: 'ok' })
  })

  it('чужая тема лентой не подхватывается', async () => {
    await addItem('Новый сорт муки', 'https://a.example/flour', ['кулинария'])
    const res = await growLiving(tpl(), current(), 'ru', 'procedure', ctx())
    expect(res.result).toBe('nothing-new')
    expect(ai.calls).toHaveLength(0)
  })

  it('событие уходит в инструкцию вместе с адресом источника — сноска, а не копия', async () => {
    await addItem('Вышел релиз v2', 'https://a.example/v2')
    await growLiving(tpl(), current(), 'ru', 'procedure', ctx())
    expect(ai.calls[0]).toContain('https://a.example/v2')
    // Запрет пересказа — часть инструкции, а не пожелание в документации.
    expect(ai.calls[0]).toMatch(/never a retelling|GROW THE LIST/)
  })

  it('модель не ответила — материал НЕ списан: повод достанется следующему проходу', async () => {
    const id = await addItem('Вышел релиз v2', 'https://a.example/v2')
    ai.reply = null

    const res = await growLiving(tpl(), current(), 'ru', 'procedure', ctx())

    expect(res.result).toBe('failed')
    const [row] = await db.select().from(feedItems).where(eq(feedItems.id, id))
    expect(row.usedAt).toBeNull()
    expect(await journal()).toHaveLength(0)
  })
})

describe('чем ищем материал', () => {
  // Теги списку придумала МОДЕЛЬ при создании, а тему подписки задавал ЧЕЛОВЕК — они законно
  // не совпадают. Ищи мы только по тегам списка, лента, рождённая из новости, больше никогда
  // не нашла бы себе материала: молчала бы вечно и выглядела бы «просто не растущей».
  it('домены мастера расширяют поиск: тег списка с темой подписки не совпал', async () => {
    await db.update(templates).set({ tags: ['kubernetes'] }).where(eq(templates.id, tplId))
    await addItem('Вышел релиз v2', 'https://a.example/v2', ['devops'])

    const byTagsOnly = await growLiving({ ...tpl(), tags: ['kubernetes'] }, current(), 'ru', 'procedure', ctx())
    expect(byTagsOnly.result).toBe('nothing-new')

    const withDomains = await growLiving({ ...tpl(), tags: ['kubernetes'] }, current(), 'ru', 'procedure', { ...ctx(), domains: ['devops'] })
    expect(withDomains.result).toBe('grown')
  })
})
