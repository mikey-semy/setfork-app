import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * ЧЕРНОВИК ПРАВОК: копится сколько угодно, версия появляется ОДНОЙ публикацией.
 *
 * Проверяем то, за чем вся затея: сохранение черновика не двигает версию списка,
 * публикация создаёт ровно одну версию и забирает черновик, а черновик от старой
 * версии публиковать нельзя — иначе он затёр бы чужую работу.
 *
 * Требует ЖИВОГО ядра (SETFORK_CORE_ADDR): публикация идёт обычным путём записи,
 * через git-коммит. Без ядра тест пропускается, а не притворяется зелёным.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const описание = CORE ? describe : describe.skip

const { db, listDrafts, templates, templateVersions, users } = await import('@/shared/db')
const { publishDraftFor, upsertDraft, deleteDraft } = await import('@/features/library/draft')
const { getDraft } = await import('@/features/library/queries')

let ownerId = ''
let tplId = ''

const block = (title: string) => ({
  n: 1,
  title: { en: title },
  desc: {},
  command: '',
  level: 'required' as const,
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  imageRef: null,
  hasImage: false,
  needsHuman: false,
  needsHumanAsk: {},
})

async function freshList(slug: string) {
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, desc: {}, tags: [], currentVersion: 1, status: 'published' })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'seeded' })
  return tpl.id
}

const listRow = async (id: string) => {
  const [row] = await db
    .select({ id: templates.id, currentVersion: templates.currentVersion, tags: templates.tags, ordered: templates.ordered, gated: templates.gated })
    .from(templates)
    .where(eq(templates.id, id))
  return row
}

описание('черновик правок', () => {
  beforeAll(async () => {
    if (!CORE) return
    await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
    const [u] = await db.insert(users).values({ handle: 'draft-owner' }).returning({ id: users.id })
    ownerId = u.id
    tplId = await freshList('draft-flow')
  })

  it('сохранение копится и НЕ создаёт версию', async () => {
    const tpl = await listRow(tplId)
    await upsertDraft(tpl, ownerId, { items: [block('первая правка')] as never, meta: {}, note: '' })
    await upsertDraft(tpl, ownerId, { items: [block('вторая правка')] as never, meta: {}, note: 'заметка' })

    const after = await listRow(tplId)
    expect(after.currentVersion).toBe(1)
    const versions = await db.select().from(templateVersions).where(eq(templateVersions.templateId, tplId))
    expect(versions).toHaveLength(1)

    const draft = await getDraft(tplId, ownerId)
    expect(draft?.baseVersion).toBe(1)
    expect(draft?.note).toBe('заметка')
    expect(draft?.items).toHaveLength(1)
  })

  it('публикация даёт ОДНУ версию и забирает черновик', async () => {
    const res = await publishDraftFor(await listRow(tplId), ownerId)
    expect(res).toMatchObject({ version: 2 })

    const after = await listRow(tplId)
    expect(after.currentVersion).toBe(2)
    expect(await getDraft(tplId, ownerId)).toBeNull()
  })

  it('публиковать нечего — говорит прямо, ничего не пишет', async () => {
    const res = await publishDraftFor(await listRow(tplId), ownerId)
    expect(res).toMatchObject({ error: 'no draft' })
    expect((await listRow(tplId)).currentVersion).toBe(2)
  })

  it('черновик от старой версии публиковать нельзя', async () => {
    const tpl = await listRow(tplId)
    await upsertDraft(tpl, ownerId, { items: [block('правка от старой версии')] as never, meta: {}, note: '' })
    // Кто-то опубликовал версию, пока правки лежали в черновике.
    await db.insert(templateVersions).values({ templateId: tplId, version: 3, note: 'чужая версия' })
    await db.update(templates).set({ currentVersion: 3 }).where(eq(templates.id, tplId))

    const res = await publishDraftFor(await listRow(tplId), ownerId)
    expect(res).toMatchObject({ error: 'stale', baseVersion: 2, currentVersion: 3 })
    // Черновик на месте — правки не потеряны, человек решает сам.
    expect(await getDraft(tplId, ownerId)).not.toBeNull()
    expect((await listRow(tplId)).currentVersion).toBe(3)
    await deleteDraft(tplId, ownerId)
  })

  it('черновики раздельны по авторам', async () => {
    const [other] = await db.insert(users).values({ handle: 'draft-mate' }).returning({ id: users.id })
    const tpl = await listRow(tplId)
    await upsertDraft(tpl, ownerId, { items: [block('моя правка')] as never, meta: {}, note: '' })
    await upsertDraft(tpl, other.id, { items: [block('правка соавтора')] as never, meta: {}, note: '' })

    const mine = await getDraft(tplId, ownerId)
    const theirs = await getDraft(tplId, other.id)
    expect(mine?.items).not.toEqual(theirs?.items)
    const rows = await db.select().from(listDrafts).where(and(eq(listDrafts.templateId, tplId)))
    expect(rows).toHaveLength(2)
    await deleteDraft(tplId, ownerId)
    await deleteDraft(tplId, other.id)
  })

  it('черновик, созданный ОДНИМ сохранением, публикация тоже забирает', async () => {
    // Ловушка, найденная на живом прогоне: удаление сверяли по updated_at, а у
    // timestamptz в базе микросекунды против миллисекунд у JS-Date — строка не
    // находилась, и черновик продолжал висеть после публикации. Тест намеренно делает
    // РОВНО ОДИН upsert: при двух срабатывал onConflictDoUpdate со своим временем, и
    // баг прятался.
    const tplId2 = await freshList('draft-single-save')
    await upsertDraft(await listRow(tplId2), ownerId, { items: [block('единственное сохранение')] as never, meta: {}, note: '' })
    const res = await publishDraftFor(await listRow(tplId2), ownerId)
    expect(res).toMatchObject({ version: 2 })
    expect(await getDraft(tplId2, ownerId)).toBeNull()
  })
})
