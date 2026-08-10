import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

// Прежний адрес списка обязан доводить агента до места. Ссылки живут в памяти агентов
// и в их конфигах дольше, чем название списка: переименование не должно превращать
// каждую такую ссылку в «list not found».
//
// Проверяем на реальной БД именно резолв, а не отдельные инструменты: через него ходят
// и чтения, и записи MCP, и ошибка здесь стоила бы сразу всем.
const { db, listRedirects, templates, userRedirects, users } = await import('@/shared/db')
const { resolveListRefOrMoved } = await import('@/features/mcp/tools/shared')

let ownerId = ''
let templateId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [owner] = await db.insert(users).values({ handle: 'moved-owner' }).returning({ id: users.id })
  ownerId = owner.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'new-address', title: { en: 'Moved list' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  // Список переименовали, ник владельца тоже сменили — оба прежних адреса ведут сюда.
  await db.insert(listRedirects).values({ ownerId, slug: 'old-address', templateId })
  await db.insert(userRedirects).values({ handle: 'moved-owner-old', userId: ownerId })
})

describe('resolveListRefOrMoved', () => {
  it('текущий адрес — без пометки о переезде', async () => {
    const found = await resolveListRefOrMoved('moved-owner/new-address')
    expect(found?.id).toBe(templateId)
    expect(found?.movedTo).toBeNull()
  })

  it('прежний слаг доводит и сообщает новый адрес', async () => {
    const found = await resolveListRefOrMoved('moved-owner/old-address')
    expect(found?.id).toBe(templateId)
    expect(found?.movedTo).toBe('moved-owner/new-address')
  })

  it('прежний ник владельца — тоже', async () => {
    const found = await resolveListRefOrMoved('moved-owner-old/new-address')
    expect(found?.id).toBe(templateId)
    expect(found?.movedTo).toBe('moved-owner/new-address')
  })

  it('оба переезда сразу: прежний ник И прежний слаг', async () => {
    const found = await resolveListRefOrMoved('moved-owner-old/old-address')
    expect(found?.id).toBe(templateId)
    expect(found?.movedTo).toBe('moved-owner/new-address')
  })

  it('ссылка без владельца работает и по прежнему слагу', async () => {
    expect((await resolveListRefOrMoved('old-address'))?.id).toBe(templateId)
  })

  it('несуществующий адрес остаётся ненайденным', async () => {
    expect(await resolveListRefOrMoved('moved-owner/nothing-here')).toBeNull()
    expect(await resolveListRefOrMoved('nobody/new-address')).toBeNull()
  })
})
