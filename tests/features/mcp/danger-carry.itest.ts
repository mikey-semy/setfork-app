import { and, asc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * РЕШЕНИЕ АВТОРА О РАЗРУШИТЕЛЬНОМ ПУНКТЕ ПЕРЕЖИВАЕТ ПАТЧ СОСЕДНЕГО БЛОКА.
 *
 * Тристейт объявлен так: пометка не задана — ставим по шаблону команды; задана (в том числе
 * явным false) — уважаем решение автора. Найдено линзой ядра 02 (19.08) прогоном: MCP-патч
 * собирал состав конвертером, который `danger` НЕ переносил, — и пометка не оставалась
 * пустой, а пересчитывалась по шаблону. То есть ручная пометка на безопасной с виду команде
 * слетала от правки чужого блока, а снятая с подозрительной — возвращалась.
 *
 * Цена: пометка глушит команду в собранном скрипте (`get_script`) и рисует предупреждение.
 * Потеряв её, разрушительная команда уезжает человеку как обычная.
 *
 * Проверяется ОБЕ стороны тристейта: поставленная пометка и снятая.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const { db, steps, templates, templateVersions, users } = await import('@/shared/db')
const { mcpCreateList } = await import('@/features/mcp/tools/lists/create')
const { mcpPatchList } = await import('@/features/mcp/tools/lists/edit')
const { mcpGetList } = await import('@/features/mcp/tools/reads')

let ownerId = ''

const rowsOf = async (slug: string) => {
  const [tpl] = await db.select({ id: templates.id, current: templates.currentVersion }).from(templates).where(eq(templates.slug, slug))
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.current)))
  return db.select({ n: steps.n, title: steps.title, command: steps.command, danger: steps.danger, needsHuman: steps.needsHuman }).from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
}

description('линза 02 §5 · пометка автора против чужого патча', () => {
  beforeAll(async () => {
    await resetTables([templates, users])
    const [u] = await db.insert(users).values({ handle: 'carry', email: 'carry@x.dev', name: 'C' }).returning({ id: users.id })
    ownerId = u.id
  })

  it('ручная пометка «разрушительный» переживает патч соседнего блока', async () => {
    const made = (await mcpCreateList(ownerId, {
      title: 'Carry',
      items: [
        // Команда по шаблону БЕЗОПАСНА: пометку может поставить только человек.
        { title: 'первый', command: 'docker compose down' },
        { title: 'второй', command: '' },
      ],
    })) as { ref: string }
    const slug = made.ref.split('/')[1]

    // Человек пометил пункт разрушительным вручную (так делает переключатель в редакторе).
    const before = await rowsOf(slug)
    const [tpl] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tpl.id))
    await db.update(steps).set({ danger: true }).where(and(eq(steps.versionId, ver.id), eq(steps.n, before[0].n)))

    // Патчим ВТОРОЙ блок — первого не касаемся вовсе.
    const read = (await mcpGetList(ownerId, 'carry', slug)) as unknown as { version: number; steps: { bid: string; title: string }[] }
    const second = read.steps.find((s) => s.title === 'второй')
    const res = await mcpPatchList(ownerId, 'carry', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: second!.bid, title: 'второй правленый' }],
    } as never)
    expect(res).not.toHaveProperty('error')

    const after = await rowsOf(slug)
    expect(after[0].danger).toBe(true)
  })

  it('снятая автором пометка не возвращается шаблоном команды', async () => {
    const made = (await mcpCreateList(ownerId, {
      title: 'Carry off',
      items: [
        // Команда по шаблону ПОДОЗРИТЕЛЬНА, но автор решил, что здесь она безопасна.
        { title: 'первый', command: 'rm -rf ./build' },
        { title: 'второй', command: '' },
      ],
    })) as { ref: string }
    const slug = made.ref.split('/')[1]
    const [tpl] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tpl.id))
    await db.update(steps).set({ danger: false }).where(eq(steps.versionId, ver.id))

    const read = (await mcpGetList(ownerId, 'carry', slug)) as unknown as { version: number; steps: { bid: string; title: string }[] }
    const second = read.steps.find((s) => s.title === 'второй')
    const res = await mcpPatchList(ownerId, 'carry', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: second!.bid, title: 'второй правленый' }],
    } as never)
    expect(res).not.toHaveProperty('error')

    const after = await rowsOf(slug)
    expect(after[0].danger).toBe(false)
  })
})
