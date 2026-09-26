import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../helpers/reset-db'

/**
 * ПЕРЕКЛАДКА КЛЮЧЕЙ ЯЗЫКА НА ЖИВОЙ БАЗЕ И ЯДРЕ (ADR-0030).
 *
 * Воспроизводится состояние прода: русский список (lang = ru), у которого шаги лежат под `en`
 * — так их писал MCP до setfork-app#1033. План обязан его найти и ничего не записать;
 * применение — переложить новой версией через ядро; повтор — не делать ничего. Спорное поле
 * (два чужих ключа) остаётся как было. Фикстура пишется доменной записью с ключом `en` явно, а
 * не через MCP: MCP теперь кладёт текст под язык списка, и тест потерял бы предмет проверки.
 */
const { db, steps, templates, templateVersions, users } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')
const { planRekey, applyRekey, REKEY_NOTE } = await import('../../scripts/rekey-list-lang')

const HANDLE = 'rekey-owner'
let ownerId = ''

const step = (n: number, title: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  n, type: 'step', content: {}, blockId: randomUUID(), title, desc: {}, command: '', level: 'required', why: {},
  needsHuman: false, needsHumanAsk: {}, section: {}, subtasks: [], refs: [], imageRef: null, ...extra,
})

async function make(slug: string, lang: string, stepList: ReturnType<typeof step>[], desc: Record<string, string> = {}) {
  const created = (await listStore.create({
    ownerId, slug, title: { [lang]: `Список ${slug}` }, desc, tags: ['суп'], status: 'published', lang, steps: stepList,
  } as never)) as { id: string }
  return created.id
}

async function current(slug: string) {
  const [tpl] = await db.select({ id: templates.id, v: templates.currentVersion, desc: templates.desc, tags: templates.tags }).from(templates).where(eq(templates.slug, slug))
  const [ver] = await db
    .select({ id: templateVersions.id, note: templateVersions.note })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.v)))
  const rows = await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(steps.n)
  return { ...tpl, note: ver.note, rows }
}

beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: HANDLE, email: 'rekey@x.dev' }).returning({ id: users.id })
  ownerId = u.id
  await make('mcp-soup', 'ru', [
    step(1, { en: 'Замочить горох' }, { desc: { en: 'На ночь' }, subtasks: [{ en: 'Горох разбух' }], refs: [{ label: { en: 'Рецепт' }, url: 'https://example.com' }] }),
    step(2, { en: 'Сварить' }, { command: 'echo варить', section: { en: 'Готовка' } }),
  ], { en: 'Густой суп' })
  await make('clean-soup', 'ru', [step(1, { ru: 'Нарезать' })])
  await make('translated-be', 'be', [step(1, { ru: 'Нарэзаць', en: 'Cut' }), step(2, { en: 'Зварыць' })])
})

describe('план', () => {
  it('находит списки с чужими ключами и ничего не пишет', async () => {
    const before = await current('mcp-soup')
    const plan = await planRekey()
    expect(plan).toEqual([
      { ref: `${HANDLE}/mcp-soup`, lang: 'ru', version: before.v, moved: 7, ambiguous: 0 },
      { ref: `${HANDLE}/translated-be`, lang: 'be', version: expect.any(Number), moved: 1, ambiguous: 1 },
    ])
    expect((await current('mcp-soup')).v).toBe(before.v)
  })
})

describe('применение', () => {
  it('перекладывает новой версией через ядро, остальное — как было', async () => {
    const before = await current('mcp-soup')
    const done = await applyRekey()
    expect(done.map((d) => [d.ref, d.error ?? null])).toEqual([
      [`${HANDLE}/mcp-soup`, null],
      [`${HANDLE}/translated-be`, null],
    ])
    const after = await current('mcp-soup')
    expect(after.v).toBe(before.v + 1)
    expect(after.note).toBe(REKEY_NOTE)
    expect(after.desc).toEqual({ ru: 'Густой суп' })
    expect(after.tags).toEqual(before.tags)
    expect(after.rows.map((r) => [r.title, r.desc, r.section, r.subtasks, r.refs, r.command, r.blockId])).toEqual([
      [{ ru: 'Замочить горох' }, { ru: 'На ночь' }, {}, [{ ru: 'Горох разбух' }], [{ label: { ru: 'Рецепт' }, url: 'https://example.com' }], '', before.rows[0].blockId],
      [{ ru: 'Сварить' }, {}, { ru: 'Готовка' }, [], [], 'echo варить', before.rows[1].blockId],
    ])
  })

  it('спорное поле остаётся как было, однозначное рядом — переложено', async () => {
    const after = await current('translated-be')
    expect(after.rows.map((r) => r.title)).toEqual([{ ru: 'Нарэзаць', en: 'Cut' }, { be: 'Зварыць' }])
  })

  it('чистый список не получает версию', async () => {
    const clean = await current('clean-soup')
    expect(clean.note).not.toBe(REKEY_NOTE)
  })

  it('повторный запуск ничего не делает', async () => {
    const v = (await current('mcp-soup')).v
    expect(await applyRekey()).toEqual([])
    expect((await current('mcp-soup')).v).toBe(v)
    expect((await planRekey()).map((r) => [r.ref, r.moved])).toEqual([[`${HANDLE}/translated-be`, 0]])
  })
})
