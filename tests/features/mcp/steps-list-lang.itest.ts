import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * MCP ЧИТАЕТ И ПИШЕТ СПИСОК НА ЯЗЫКЕ ЕГО ОРИГИНАЛА (ADR-0030).
 *
 * Раньше обе стороны стояли на `en`: шаги русского списка, созданного агентом, ложились под
 * `en`, и сайт показывал их как английский «перевод» русского оригинала. Чинить только запись
 * нельзя: у русского списка с английским переводом get_list отдавал бы перевод, агент правил бы
 * его и возвращал — и правка ложилась бы под `ru`, затирая оригинал переводом. Поэтому здесь
 * проверяется круг целиком: что отдано, под какой ключ легло и что стало с переводом.
 */
const { db, steps, suggestions, templates, templateVersions, users } = await import('@/shared/db')
const { mcpCreateList } = await import('@/features/mcp/tools/lists/create')
const { mcpGetList } = await import('@/features/mcp/tools/reads')
const { mcpUpdateList, mcpPatchList } = await import('@/features/mcp/tools/lists/edit')
const { mcpSuggestEdit } = await import('@/features/mcp/tools')

const HANDLE = 'mcp-steps-lang'
let ownerId = ''
beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: HANDLE, email: 'mcp-steps-lang@x.dev' }).returning({ id: users.id })
  ownerId = u.id
})

/** Заголовки шагов ТЕКУЩЕЙ версии как они лежат в базе — с ключами языков. */
async function stepTitles(slug: string) {
  const [tpl] = await db.select({ id: templates.id, v: templates.currentVersion }).from(templates).where(eq(templates.slug, slug))
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.v)))
  const rows = await db.select({ n: steps.n, title: steps.title }).from(steps).where(eq(steps.versionId, ver.id)).orderBy(steps.n)
  return { versionId: ver.id, titles: rows.map((r) => r.title) }
}

const slugOf = (ref: string) => ref.split('/')[1]

describe('create_list: шаги под языком списка', () => {
  it('русский список без lang — шаги под ru, как и заголовок', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Гороховый суп', items: [{ title: 'Замочить горох' }] })) as { ref: string }
    expect((await stepTitles(slugOf(made.ref))).titles).toEqual([{ ru: 'Замочить горох' }])
  })

  it('lang: be — шаги под be', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Гарбузовы суп', lang: 'be', items: [{ title: 'Нарэзаць гарбуз' }] })) as { ref: string }
    expect((await stepTitles(slugOf(made.ref))).titles).toEqual([{ be: 'Нарэзаць гарбуз' }])
  })
})

describe('русский список с английским переводом', () => {
  let slug = ''
  beforeAll(async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Борщ', lang: 'ru', items: [{ title: 'Сварить бульон' }, { title: 'Нарезать свёклу' }] })) as { ref: string }
    slug = slugOf(made.ref)
    // Перевод шагов, как его кладёт кнопка «Перевести»: второй ключ рядом с оригиналом.
    const { versionId } = await stepTitles(slug)
    await db.execute(sql`UPDATE steps SET title = title || jsonb_build_object('en', 'EN ' || (title->>'ru')) WHERE version_id = ${versionId}`)
  })

  it('get_list отдаёт оригинал, а не перевод, и называет язык', async () => {
    const got = (await mcpGetList(ownerId, HANDLE, slug)) as { lang?: string; steps: { title?: string }[] }
    expect(got.lang).toBe('ru')
    expect(got.steps.map((s) => s.title)).toEqual(['Сварить бульон', 'Нарезать свёклу'])
  })

  it('patch_list: правка ложится в оригинал, перевод рядом не трогается', async () => {
    const got = (await mcpGetList(ownerId, HANDLE, slug)) as { version: number; steps: { bid: string }[] }
    const res = await mcpPatchList(ownerId, HANDLE, slug, {
      baseVersion: got.version,
      ops: [{ op: 'update', bid: got.steps[0].bid, title: 'Сварить мясной бульон' }],
    })
    expect(res).not.toHaveProperty('error')
    expect((await stepTitles(slug)).titles[0]).toEqual({ ru: 'Сварить мясной бульон', en: 'EN Сварить бульон' })
  })

  it('patch_list insert и update_list: новый текст — под ru, не под en', async () => {
    const before = (await mcpGetList(ownerId, HANDLE, slug)) as { version: number; steps: { bid: string }[] }
    const ins = await mcpPatchList(ownerId, HANDLE, slug, {
      baseVersion: before.version,
      ops: [{ op: 'insert', after: before.steps[1].bid, block: { title: 'Добавить капусту' } }],
    })
    expect(ins).not.toHaveProperty('error')
    expect((await stepTitles(slug)).titles[2]).toEqual({ ru: 'Добавить капусту' })

    const cur = (await mcpGetList(ownerId, HANDLE, slug)) as { version: number; steps: { bid: string; title?: string }[] }
    const upd = await mcpUpdateList(ownerId, HANDLE, slug, {
      baseVersion: cur.version,
      items: cur.steps.map((s) => ({ bid: s.bid, title: s.title })),
    })
    expect(upd).not.toHaveProperty('error')
    for (const t of (await stepTitles(slug)).titles) expect(Object.keys(t as object)).toEqual(['ru'])
  })
})

describe('suggest_edit: чужой список', () => {
  it('правка к русскому списку — под ru: тем языком, на котором агент список прочитал', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Окрошка', lang: 'ru', items: [{ title: 'Нарезать огурцы' }] })) as { ref: string }
    await db.update(templates).set({ visibility: 'public', status: 'published' }).where(eq(templates.slug, slugOf(made.ref)))
    const [fan] = await db.insert(users).values({ handle: 'mcp-steps-lang-fan' }).returning({ id: users.id })
    const res = await mcpSuggestEdit(fan.id, { list: made.ref, note: 'уточнил', items: [{ title: 'Нарезать огурцы кубиком' }] })
    expect(res).not.toHaveProperty('error')
    const [row] = await db.select({ items: suggestions.items }).from(suggestions).where(eq(suggestions.authorId, fan.id))
    expect(row.items.map((it) => it.title)).toEqual([{ ru: 'Нарезать огурцы кубиком' }])
  })
})
