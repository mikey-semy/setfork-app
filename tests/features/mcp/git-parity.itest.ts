import { and, eq, asc } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОСЛЕ ЛЮБОЙ ЗАПИСИ СОДЕРЖИМОЕ БАЗЫ И GIT СОВПАДАЮТ.
 *
 * Это главный закон ядра (ADR-0014: git — канон, Postgres — read-model), и 19.08 линза 02
 * измерила, что он нарушается: правка списка-черновика через MCP шла прямо в Postgres, мимо
 * ядра, и git о ней не узнавал никогда. Публикация списка не выравнивала — она меняет только
 * статус. Сайт показывал одно, `git clone` отдавал другое.
 *
 * Хуже того, потеря тома не восстанавливала историю, а переписывала её: ядро материализует
 * репозиторий из Postgres, и та же версия v1 получала другое содержимое и другой SHA.
 *
 * Реестр находок: hq/reviews/core/2026-08-19-02-git-integrity-ledger.md.
 * Решение: hq/strategy/decisions/0020-version-on-purpose-visibility-apart.md.
 *
 * Требует ЖИВОГО ядра (SETFORK_CORE_ADDR): проверяется именно граница «фронт → ядро → git».
 * Без ядра тест пропускается, а не притворяется зелёным.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const описание = CORE ? describe : describe.skip

const { db, templates, templateVersions, steps, users } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')
const { mcpUpdateList, mcpPatchList } = await import('@/features/mcp/tools/lists/edit')
const { mcpCreateList } = await import('@/features/mcp/tools/lists/create')
const { gitCore } = await import('@/features/git/core')

const HANDLE = 'parity-owner'
let ownerId = ''

const gitTitles = async (slug: string) => {
  const snap = (await gitCore.branchSnapshot({ owner: HANDLE, slug }, 'main')) as { steps: { title: string }[] } | null
  return (snap?.steps ?? []).map((s) => s.title)
}

const dbTitles = async (tplId: string) => {
  const [tpl] = await db.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, tplId))
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tplId), eq(templateVersions.version, tpl.current)))
  const rows = await db.select({ title: steps.title }).from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
  return rows.map((r) => (r.title as Record<string, string>).en)
}

/** Список заводим ТЕМ ЖЕ инструментом, каким его заводит ассистент: через MCP, черновиком.
 *  Через listStore напрямую у блоков не появляется идентичности (block_id остаётся пустым),
 *  и патч по bid стал бы непроверяемым — тест проверял бы не тот путь, что живёт. */
const draftList = async (title: string) => {
  const made = (await mcpCreateList(ownerId, { title, items: [{ title }] })) as { ref: string } | { error: string }
  if ('error' in made) throw new Error(made.error)
  const slug = made.ref.split('/')[1]
  const [row] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
  return { id: row.id, slug }
}

/** Идентичность первого блока — та, что видит агент через get_list. */
const firstBid = async (tplId: string) => {
  const rows = await db
    .select({ blockId: steps.blockId })
    .from(steps)
    .innerJoin(templateVersions, eq(templateVersions.id, steps.versionId))
    .where(eq(templateVersions.templateId, tplId))
  return rows[0]?.blockId as string
}

описание('запись через MCP: база против git', () => {
  beforeAll(async () => {
    if (!CORE) return
    await resetTables([templates, users])
    const [u] = await db.insert(users).values({ handle: HANDLE, email: 'parity@x.dev', name: 'Parity' }).returning({ id: users.id })
    ownerId = u.id
  })

  it('полная замена состава в черновике доезжает до git', async () => {
    const { id, slug } = await draftList('ПЕРВОНАЧАЛЬНЫЙ')
    expect(await gitTitles(slug)).toEqual(['ПЕРВОНАЧАЛЬНЫЙ'])

    const res = await mcpUpdateList(ownerId, HANDLE, slug, { items: [{ title: 'ПРАВЛЕНЫЙ' }] } as never)
    if ('error' in (res as object)) console.log('ОТКАЗ:', JSON.stringify(res))
    expect(res).not.toHaveProperty('error')
    // Именно это и расходилось: в БД правка есть, в git её нет.
    expect(await dbTitles(id)).toEqual(['ПРАВЛЕНЫЙ'])
    expect(await gitTitles(slug)).toEqual(['ПРАВЛЕНЫЙ'])
  })

  it('точечный патч блока в черновике доезжает до git', async () => {
    const { id, slug } = await draftList('ДО ПАТЧА')
    // Снимок ДО правки обязателен: он материализует репозиторий. Без него первый же
    // снимок соберётся из Postgres и покажет правку, которой в git нет, — расхождение
    // замаскируется ровно тем механизмом, который потом перепишет историю (F2 линзы 02).
    expect(await gitTitles(slug)).toEqual(['ДО ПАТЧА'])
    const bid = await firstBid(id)
    expect(bid).toBeTruthy()

    const res = await mcpPatchList(ownerId, HANDLE, slug, {
      baseVersion: 1,
      ops: [{ op: 'update', bid, title: 'ПОСЛЕ ПАТЧА' }],
    } as never)
    if ('error' in (res as object)) console.log('ОТКАЗ:', JSON.stringify(res))
    expect(res).not.toHaveProperty('error')
    expect(await dbTitles(id)).toEqual(['ПОСЛЕ ПАТЧА'])
    expect(await gitTitles(slug)).toEqual(['ПОСЛЕ ПАТЧА'])
  })

  it('правки, отложенные в рабочую копию, версию НЕ создают и git не двигают', async () => {
    const { id, slug } = await draftList('ИСХОДНЫЙ')
    const before = (await gitCore.branchSnapshot({ owner: HANDLE, slug }, 'main')) as { tipSha: string }

    const res = await mcpPatchList(ownerId, HANDLE, slug, {
      baseVersion: 1,
      publish: false,
      ops: [{ op: 'update', bid: await firstBid(id), title: 'ОТЛОЖЕННЫЙ' }],
    } as never)
    if ('error' in (res as object)) console.log('ОТКАЗ:', JSON.stringify(res))
    expect(res).not.toHaveProperty('error')

    // Рабочая копия — не версия: живой список и git остаются прежними.
    expect(await dbTitles(id)).toEqual(['ИСХОДНЫЙ'])
    const after = (await gitCore.branchSnapshot({ owner: HANDLE, slug }, 'main')) as { tipSha: string }
    expect(after.tipSha).toBe(before.tipSha)
  })
})
