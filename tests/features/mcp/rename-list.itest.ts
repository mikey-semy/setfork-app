import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * `rename_list` — ТЕ ЖЕ ПРАВИЛА, ЧТО У ФОРМЫ НАСТРОЕК, НА НАСТОЯЩЕЙ БАЗЕ.
 *
 * Проверяется то, ради чего правила вынесены в `rename-core`, а не скопированы:
 *  • прежний адрес продолжает вести на список — агент по старой ссылке находит его;
 *  • к прежнему адресу можно вернуться (запись, занимавшая новое имя, снимается);
 *  • занятый адрес — отказ с подсказкой свободного, а не тупик;
 *  • чужой список — отказ, адрес не меняется.
 * Подменён только кэш Next: вне запроса `revalidatePath` бросает.
 */
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { db, templates, users } = await import('@/shared/db')
const { mcpRenameList } = await import('@/features/mcp/tools/lists/rename')
const { resolveListRefOrMoved } = await import('@/features/mcp/tools/shared')

const OWNER = 'renamer'
let ownerId = ''
let strangerId = ''
let listId = ''

beforeAll(async () => {
  await resetTables([templates, users])
  const rows = await db.insert(users).values([{ handle: OWNER }, { handle: 'rename-stranger' }]).returning({ id: users.id, handle: users.handle })
  ownerId = rows.find((r) => r.handle === OWNER)!.id
  strangerId = rows.find((r) => r.handle === 'rename-stranger')!.id
  const [t] = await db.insert(templates).values({ ownerId, slug: 'review-kit', title: { en: 'kit' } }).returning({ id: templates.id })
  listId = t.id
  await db.insert(templates).values({ ownerId, slug: 'busy', title: { en: 'busy' } })
})

const slugNow = async () => (await db.select({ slug: templates.slug }).from(templates).where(eq(templates.id, listId)))[0].slug

describe('rename_list', () => {
  it('меняет адрес, прежний ведёт на тот же список', async () => {
    const res = await mcpRenameList(ownerId, { list: `${OWNER}/review-kit`, slug: 'Finetooth' })
    expect(res).toMatchObject({ ref: `${OWNER}/finetooth`, previous: `${OWNER}/review-kit` })
    expect(await slugNow()).toBe('finetooth')
    const old = await resolveListRefOrMoved(`${OWNER}/review-kit`)
    expect(old).toMatchObject({ id: listId, movedTo: `${OWNER}/finetooth` })
  })

  it('по старой ссылке можно переименовать дальше и вернуться к прежнему имени', async () => {
    expect(await mcpRenameList(ownerId, { list: `${OWNER}/review-kit`, slug: 'review-kit' })).toMatchObject({ ref: `${OWNER}/review-kit` })
    expect(await slugNow()).toBe('review-kit')
    expect(await mcpRenameList(ownerId, { list: `${OWNER}/review-kit`, slug: 'finetooth' })).toMatchObject({ ref: `${OWNER}/finetooth` })
  })

  it('занятый адрес — отказ с подсказкой свободного', async () => {
    const res = await mcpRenameList(ownerId, { list: `${OWNER}/finetooth`, slug: 'busy' })
    expect(res).toMatchObject({ error: expect.stringContaining('already have a list'), suggestion: expect.stringMatching(/^busy-/) })
    expect(await slugNow()).toBe('finetooth')
  })

  it('тот же адрес и пустой — отказ словами', async () => {
    expect(await mcpRenameList(ownerId, { list: `${OWNER}/finetooth`, slug: 'finetooth' })).toEqual({ error: expect.stringContaining('already the address') })
    expect(await mcpRenameList(ownerId, { list: `${OWNER}/finetooth`, slug: '   ' })).toEqual({ error: expect.stringContaining('empty') })
  })

  it('чужой список — отказ, адрес не меняется', async () => {
    expect(await mcpRenameList(strangerId, { list: `${OWNER}/finetooth`, slug: 'stolen' })).toEqual({ error: expect.stringContaining('only the list owner') })
    expect(await slugNow()).toBe('finetooth')
  })
})
