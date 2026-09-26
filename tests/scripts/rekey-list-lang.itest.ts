import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../helpers/reset-db'

/**
 * ПЕРЕКЛАДКА КЛЮЧЕЙ ЯЗЫКА НА ЖИВОЙ БАЗЕ И ЯДРЕ (ADR-0030).
 *
 * Воспроизводится состояние прода: русский список (lang = ru), у которого текст лежит под `en`
 * — так его писал MCP до setfork-app#1033. План обязан его найти и ничего не записать;
 * применение — переложить новой версией через ядро, не потеряв НИ ОДНОГО другого поля блока;
 * повтор — не делать ничего. Не трогаются: переведённый список, список без языка или с мусором
 * в языке, список с открытым черновиком. Фикстура пишется доменной записью с ключом `en` явно,
 * а не через MCP: MCP теперь кладёт текст под язык списка, и тест потерял бы предмет проверки.
 */
const { db, listDrafts, steps, templates, templateVersions, users } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')
const { planRekey, applyRekey, REKEY_NOTE } = await import('../../scripts/rekey-list-lang')

const HANDLE = 'rekey-owner'
let ownerId = ''

const block = (n: number, extra: Record<string, unknown>) => ({
  n, type: 'step', content: {}, blockId: randomUUID(), title: {}, desc: {}, command: '', level: 'required', why: {},
  needsHuman: false, needsHumanAsk: {}, section: {}, subtasks: [], refs: [], imageRef: null, ...extra,
})

async function make(slug: string, lang: string | null, blocks: ReturnType<typeof block>[], meta: { title?: Record<string, string>; desc?: Record<string, string> } = {}) {
  const created = (await listStore.create({
    ownerId, slug, title: meta.title ?? { [lang ?? 'ru']: `Список ${slug}` }, desc: meta.desc ?? {}, tags: ['суп'], ordered: false,
    status: 'published', lang, steps: blocks,
  } as never)) as { id: string }
  return created.id
}

async function current(slug: string) {
  const [tpl] = await db
    .select({ id: templates.id, v: templates.currentVersion, title: templates.title, desc: templates.desc, tags: templates.tags, ordered: templates.ordered })
    .from(templates)
    .where(eq(templates.slug, slug))
  const [ver] = await db
    .select({ id: templateVersions.id, note: templateVersions.note })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.v)))
  const rows = await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(steps.n)
  return { ...tpl, note: ver.note, rows }
}

/** Строка шага без полей, которые у новой версии обязаны быть новыми. */
const shape = (r: Record<string, unknown>) => {
  const { id: _id, versionId: _v, createdAt: _c, ...rest } = r
  return rest
}

beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: HANDLE, email: 'rekey@x.dev' }).returning({ id: users.id })
  ownerId = u.id
  // Полный набор: шаг со ВСЕМИ полями, текстовый блок, картинка с подписью, опрос.
  await make(
    'mcp-soup',
    'ru',
    [
      block(1, {
        title: { en: 'Замочить горох' }, desc: { en: 'На ночь' }, why: { en: 'Быстрее варится' }, section: { en: 'Подготовка' },
        needsHuman: true, needsHumanAsk: { en: 'Какой горох?' }, danger: true, command: 'echo замочить', level: 'optional',
        imageRef: 'u/pea.png', subtasks: [{ en: 'Горох разбух' }], refs: [{ label: { en: 'Рецепт' }, url: 'https://example.com' }],
      }),
      block(2, { type: 'text', content: { md: { en: 'Абзац про горох' }, bid: randomUUID() } }),
      block(3, { type: 'image', content: { ref: 'u/soup.png', caption: { en: 'Готовый суп' }, bid: randomUUID() } }),
      block(4, { type: 'poll', content: { question: 'Солить?', options: [{ id: 'o1', text: 'Да' }], bid: randomUUID() } }),
    ],
    { title: { en: 'Гороховый суп' }, desc: { en: 'Густой суп' } },
  )
  await make('clean-soup', 'ru', [block(1, { title: { ru: 'Нарезать' } })])
  await make('translated-pie', 'ru', [block(1, { title: { ru: 'Разогреть', en: 'Preheat' } }), block(2, { title: { en: 'Check the oven' } })])
  await make('no-lang', null, [block(1, { title: { en: 'Без языка' } })], { title: { en: 'Без языка' } })
  await db.update(templates).set({ lang: null }).where(eq(templates.slug, 'no-lang'))
  await make('junk-lang', 'ru', [block(1, { title: { en: 'Мусор в языке' } })])
  await db.update(templates).set({ lang: 'ru-RU' as never }).where(eq(templates.slug, 'junk-lang'))
  const draftId = await make('drafted', 'ru', [block(1, { title: { en: 'С черновиком' } })])
  await db.insert(listDrafts).values({ templateId: draftId, authorId: ownerId, baseVersion: 1, items: [], meta: {}, note: '' })
})

describe('план', () => {
  it('находит списки с чужими ключами, называет переведённый и ничего не пишет', async () => {
    const before = await current('mcp-soup')
    const plan = await planRekey()
    expect(plan.map((r) => [r.ref.split('/')[1], r.moved, r.held, r.sample ?? null])).toEqual([
      ['drafted', 1, false, 'С черновиком'],
      ['mcp-soup', 11, false, 'Замочить горох'],
      ['translated-pie', 1, true, 'Check the oven'],
    ])
    expect((await current('mcp-soup')).v).toBe(before.v)
  })
})

describe('применение', () => {
  let before: Awaited<ReturnType<typeof current>>
  let done: Awaited<ReturnType<typeof applyRekey>>
  beforeAll(async () => {
    before = await current('mcp-soup')
    done = await applyRekey()
  })

  it('пишет только однозначный список; черновик — отказ в итоге, остальное не трогается', () => {
    expect(done.map((d) => [d.ref.split('/')[1], !!d.error])).toEqual([
      ['drafted', true],
      ['mcp-soup', false],
    ])
  })

  it('новая версия через ядро: ключи переложены, ВСЕ прочие поля — как были', async () => {
    const after = await current('mcp-soup')
    expect([after.v, after.note]).toEqual([before.v + 1, REKEY_NOTE])
    expect([after.title, after.desc, after.tags, after.ordered]).toEqual([{ ru: 'Гороховый суп' }, { ru: 'Густой суп' }, before.tags, before.ordered])
    const ru = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll('"en":', '"ru":'))
    expect(after.rows.map(shape)).toEqual(before.rows.map((r) => ru(shape(r))))
  })

  it('переведённый, без языка, с мусором в языке, чистый, с черновиком — без новой версии', async () => {
    for (const slug of ['translated-pie', 'no-lang', 'junk-lang', 'clean-soup', 'drafted']) {
      expect((await current(slug)).note, slug).not.toBe(REKEY_NOTE)
    }
    expect((await current('translated-pie')).rows.map((r) => r.title)).toEqual([{ ru: 'Разогреть', en: 'Preheat' }, { en: 'Check the oven' }])
  })

  it('повторный запуск пишет нечего: остаются только отказы', async () => {
    const v = (await current('mcp-soup')).v
    expect((await applyRekey()).map((d) => [d.ref.split('/')[1], !!d.error])).toEqual([['drafted', true]])
    expect((await current('mcp-soup')).v).toBe(v)
  })
})
