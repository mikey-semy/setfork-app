import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * MCP: язык содержимого — любой код ISO 639-1, и он же становится языком оригинала списка
 * (ADR-0030). Раньше аргумент принимал только `ru`/`en`, и белорусский список агента
 * записывался русским или английским.
 */
const { db, templates, users } = await import('@/shared/db')
const { mcpCreateList } = await import('@/features/mcp/tools/lists/create')

let ownerId = ''
beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'mcp-lang', email: 'mcp-lang@x.dev' }).returning({ id: users.id })
  ownerId = u.id
})

async function langOf(ref: string) {
  const [row] = await db.select({ lang: templates.lang, title: templates.title }).from(templates).where(eq(templates.slug, ref.split('/')[1]))
  return row
}

describe('create_list: язык', () => {
  it('lang: be — список белорусский, текст под своим ключом', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Гарбузовы суп', lang: 'be', items: [{ title: 'Нарэзаць' }] })) as { ref: string }
    expect(await langOf(made.ref)).toMatchObject({ lang: 'be', title: { be: 'Гарбузовы суп' } })
  })

  it('без lang — определяется по тексту (ru/en)', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Гороховый суп', items: [{ title: 'Замочить' }] })) as { ref: string }
    expect((await langOf(made.ref)).lang).toBe('ru')
  })
})
