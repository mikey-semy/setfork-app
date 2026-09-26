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
 *
 * У каждого кейса свой список: исход одного не должен зависеть от того, что правил другой.
 */
const { db, steps, suggestions, templates, templateVersions, users } = await import('@/shared/db')
const { mcpCreateList } = await import('@/features/mcp/tools/lists/create')
const { mcpGetList } = await import('@/features/mcp/tools/reads')
const { mcpUpdateList, mcpPatchList } = await import('@/features/mcp/tools/lists/edit')
const { mcpPublishSkill } = await import('@/features/mcp/tools/lists/skill')
const { mcpSuggestEdit } = await import('@/features/mcp/tools')

const HANDLE = 'mcp-steps-lang'
let ownerId = ''
beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: HANDLE, email: 'mcp-steps-lang@x.dev' }).returning({ id: users.id })
  ownerId = u.id
})

type Got = {
  lang?: string
  title: string
  desc: string
  version: number
  steps: { bid: string; title?: string; desc?: string; section?: string; subtasks?: string[]; refs?: { label: string }[] }[]
  pendingEdits?: { steps: { title?: string }[] }
}
const slugOf = (ref: string) => ref.split('/')[1]
const read = async (slug: string) => (await mcpGetList(ownerId, HANDLE, slug)) as unknown as Got

/** Шаги ТЕКУЩЕЙ версии как они лежат в базе — с ключами языков. */
async function stored(slug: string) {
  const [tpl] = await db.select({ id: templates.id, v: templates.currentVersion }).from(templates).where(eq(templates.slug, slug))
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.v)))
  const rows = await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(steps.n)
  return { versionId: ver.id, rows }
}

let seq = 0
/**
 * Русский список, у которого ВСЁ переведено на английский: заголовок и описание списка, а у
 * шагов — заголовок, описание, раздел, подзадачи и подписи ссылок. Перевод кладётся рядом с
 * оригиналом, как его кладёт кнопка «Перевести»: `EN <русский текст>`.
 */
async function translatedList() {
  const made = (await mcpCreateList(ownerId, {
    title: `Борщ ${++seq}`,
    desc: 'Густой и красный',
    lang: 'ru',
    items: [
      { title: 'Сварить бульон', desc: 'Два часа', section: 'Основа', subtasks: ['Мясо мягкое'], refs: [{ label: 'Рецепт', url: 'https://example.com/a' }] },
      { title: 'Нарезать свёклу', desc: 'Соломкой', section: 'Овощи', subtasks: ['Руки в перчатках'], refs: [{ label: 'Нож', url: 'https://example.com/b' }] },
    ],
  })) as { ref: string }
  const slug = slugOf(made.ref)
  const en = (col: string) => sql.raw(`${col} || jsonb_build_object('en', 'EN ' || (${col}->>'ru'))`)
  await db.execute(sql`UPDATE templates SET title = ${en('title')}, "desc" = ${en('"desc"')} WHERE slug = ${slug}`)
  const { versionId } = await stored(slug)
  await db.execute(sql`
    UPDATE steps SET
      title = ${en('title')}, "desc" = ${en('"desc"')}, section = ${en('section')},
      subtasks = (SELECT jsonb_agg(x || jsonb_build_object('en', 'EN ' || (x->>'ru'))) FROM jsonb_array_elements(subtasks) x),
      refs = (SELECT jsonb_agg(jsonb_set(r, '{label}', (r->'label') || jsonb_build_object('en', 'EN ' || (r->'label'->>'ru')))) FROM jsonb_array_elements(refs) r)
    WHERE version_id = ${versionId}`)
  return slug
}

describe('create_list: шаги под языком списка', () => {
  it('русский список без lang — шаги под ru, как и заголовок', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Гороховый суп', items: [{ title: 'Замочить горох' }] })) as { ref: string }
    expect((await stored(slugOf(made.ref))).rows.map((r) => r.title)).toEqual([{ ru: 'Замочить горох' }])
  })

  it('lang: be — шаги под be', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Гарбузовы суп', lang: 'be', items: [{ title: 'Нарэзаць гарбуз' }] })) as { ref: string }
    expect((await stored(slugOf(made.ref))).rows.map((r) => r.title)).toEqual([{ be: 'Нарэзаць гарбуз' }])
  })
})

describe('get_list у переведённого списка', () => {
  it('отдаёт оригинал во ВСЕХ полях и называет язык', async () => {
    const got = await read(await translatedList())
    expect(got.lang).toBe('ru')
    expect([got.title.startsWith('Борщ'), got.desc]).toEqual([true, 'Густой и красный'])
    expect(got.steps[0]).toMatchObject({
      title: 'Сварить бульон',
      desc: 'Два часа',
      section: 'Основа',
      subtasks: ['Мясо мягкое'],
      refs: [{ label: 'Рецепт' }],
    })
  })

  it('список без языка — lang называет ключ, на котором отдан текст', async () => {
    const made = (await mcpCreateList(ownerId, { title: 'Як спекти хліб', items: [{ title: 'Замісити тісто' }] })) as { ref: string }
    const [row] = await db.select({ lang: templates.lang }).from(templates).where(eq(templates.slug, slugOf(made.ref)))
    expect(row.lang, 'предпосылка: язык списка не определён').toBeNull()
    const got = await read(slugOf(made.ref))
    expect(got.lang).toBe(Object.keys((await stored(slugOf(made.ref))).rows[0].title as object)[0])
  })
})

describe('запись в переведённый список', () => {
  it('patch_list: правка ложится в оригинал, перевод рядом не трогается', async () => {
    const slug = await translatedList()
    const got = await read(slug)
    const res = await mcpPatchList(ownerId, HANDLE, slug, { baseVersion: got.version, ops: [{ op: 'update', bid: got.steps[0].bid, title: 'Сварить мясной бульон' }] })
    expect(res).not.toHaveProperty('error')
    expect((await stored(slug)).rows[0].title).toEqual({ ru: 'Сварить мясной бульон', en: 'EN Сварить бульон' })
  })

  it('patch_list подзадач: нетронутая уносит свой перевод, новая — под ru', async () => {
    const slug = await translatedList()
    const got = await read(slug)
    await mcpPatchList(ownerId, HANDLE, slug, { baseVersion: got.version, ops: [{ op: 'update', bid: got.steps[0].bid, subtasks: ['Мясо мягкое', 'Бульон прозрачный'] }] })
    expect((await stored(slug)).rows[0].subtasks).toEqual([{ ru: 'Мясо мягкое', en: 'EN Мясо мягкое' }, { ru: 'Бульон прозрачный' }])
  })

  it('patch_list insert — новый блок под ru', async () => {
    const slug = await translatedList()
    const got = await read(slug)
    await mcpPatchList(ownerId, HANDLE, slug, { baseVersion: got.version, ops: [{ op: 'insert', after: got.steps[1].bid, block: { title: 'Добавить капусту' } }] })
    expect((await stored(slug)).rows[2].title).toEqual({ ru: 'Добавить капусту' })
  })

  it('update_list: присланный текст — под ru', async () => {
    const slug = await translatedList()
    const got = await read(slug)
    const res = await mcpUpdateList(ownerId, HANDLE, slug, { baseVersion: got.version, items: got.steps.map((s) => ({ bid: s.bid, title: `${s.title}!` })) })
    expect(res).not.toHaveProperty('error')
    expect((await stored(slug)).rows.map((r) => (r.title as Record<string, string>).ru)).toEqual(['Сварить бульон!', 'Нарезать свёклу!'])
  })

  it('publish_skill с блоками — под ru', async () => {
    const slug = await translatedList()
    const got = await read(slug)
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/${slug}`, baseVersion: got.version, items: [{ title: 'Подать со сметаной' }] })
    expect(res).not.toHaveProperty('error')
    expect((await stored(slug)).rows.map((r) => r.title)).toEqual([{ ru: 'Подать со сметаной' }])
  })

  it('черновик (publish:false) get_list показывает на том же языке', async () => {
    const slug = await translatedList()
    const got = await read(slug)
    await mcpPatchList(ownerId, HANDLE, slug, { baseVersion: got.version, publish: false, ops: [{ op: 'update', bid: got.steps[1].bid, desc: 'Тонкой соломкой' }] })
    expect((await read(slug)).pendingEdits?.steps.map((s) => s.title)).toEqual(['Сварить бульон', 'Нарезать свёклу'])
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
