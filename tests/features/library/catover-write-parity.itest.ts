import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПАРИТЕТ ЗАПИСИ через домен: что уезжает в ядро, то и ложится в БД.
 *
 * Долг катовера: `SETFORK_DOMAIN_WRITES=1` переключает запись версий с Postgres-
 * адаптера на Rust-ядро. Набор шагов при этом перезаписывается ЦЕЛИКОМ — значит
 * поле, о котором путь не знает, не «остаётся прежним», а исчезает. Так молча
 * терялись идентичность блока (ADR-0013) и пометка «здесь нужен человек»: ядро их
 * уже принимало, а фронт не слал, потому что в его копии proto полей не было.
 *
 * Тест требует ЖИВОГО ядра (SETFORK_CORE_ADDR + токен) — без него пропускается, а не
 * притворяется зелёным: паритет, проверенный на моках, ничего не доказывает.
 */
// Адрес ядра — тем же ключом, что в проде (SETFORK_CORE_ADDR), а не своим.
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const { db, steps, templates, templateVersions, users } = await import('@/shared/db')
const { listWriteRemote } = await import('@/features/library/list-store.remote')

let ownerId = ''

beforeAll(async () => {
  if (!CORE) return
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'cat-owner' }).returning({ id: users.id })
  ownerId = u.id
})

const step = (over: Record<string, unknown> = {}) => ({
  n: 1,
  title: { en: 'Pick a local supplier' },
  desc: {},
  command: '',
  level: 'required',
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  imageRef: null,
  ...over,
})

description('запись через ядро сохраняет идентичность и пометку', () => {
  it('create: block_id и needs_human доезжают до БД', async () => {
    const bid = '11111111-2222-3333-4444-555555555555'
    const list = await listWriteRemote.create({
      ownerId,
      slug: 'catover-create',
      title: { en: 'Catover' },
      desc: {},
      tags: [],
      ordered: true,
      visibility: 'public',
      status: 'published',
      origin: 'authored',
      forkedFromId: null,
      note: 'first',
      steps: [step({ blockId: bid, needsHuman: true, needsHumanAsk: { ru: 'сколько стоит у вас?' } })],
    } as Parameters<typeof listWriteRemote.create>[0])

    const [v] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, list.id))
    const [row] = await db.select().from(steps).where(eq(steps.versionId, v.id))
    expect(row.blockId).toBe(bid)
    expect(row.needsHuman).toBe(true)
    expect(row.needsHumanAsk).toMatchObject({ ru: 'сколько стоит у вас?' })
  })

  it('addVersion: та же идентичность переживает новую версию', async () => {
    const bid = '99999999-8888-7777-6666-555555555555'
    const list = await listWriteRemote.create({
      ownerId,
      slug: 'catover-add',
      title: { en: 'Catover 2' },
      desc: {},
      tags: [],
      ordered: true,
      visibility: 'public',
      status: 'published',
      origin: 'authored',
      forkedFromId: null,
      note: 'first',
      steps: [step({ blockId: bid })],
    } as Parameters<typeof listWriteRemote.create>[0])

    await listWriteRemote.addVersion(list.id, {
      note: 'second',
      authorId: ownerId,
      steps: [step({ blockId: bid, title: { en: 'Pick a local supplier (edited)' } })],
    } as Parameters<typeof listWriteRemote.addVersion>[1])

    const rows = await db
      .select({ blockId: steps.blockId, version: templateVersions.version })
      .from(steps)
      .innerJoin(templateVersions, eq(templateVersions.id, steps.versionId))
      .where(eq(templateVersions.templateId, list.id))
    expect(rows).toHaveLength(2)
    // Один и тот же blockId в обеих версиях — иначе дифф читает правку как
    // «удалён + добавлен», и к переименованному пункту не привязать обсуждение.
    expect(new Set(rows.map((r) => r.blockId))).toEqual(new Set([bid]))
  })
})
