import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Link-checker без сети: харвест по всем поверхностям (refs/product/inline-md)
// против реального PG + свип с инжектированной пробой (эскалация broken).
const { appSettings, db, linkChecks, linkOccurrences, templates, users } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')
const { harvestTemplate } = await import('@/features/linkcheck/harvest')
const { runLinkcheckSweep } = await import('@/features/linkcheck/service')
const { clearLinkcheckCache } = await import('@/shared/settings/linkcheck')

let templateId = ''

const wipe = async () => {
  await db.execute(sql`truncate table ${templates}, ${users}, ${linkChecks}, ${linkOccurrences}, ${appSettings} restart identity cascade`)
}

beforeAll(async () => {
  await wipe()
  const [owner] = await db.insert(users).values({ handle: 'linkowner' }).returning({ id: users.id })
  const list = await listStore.create({
    ownerId: owner.id,
    slug: 'links-demo',
    title: { en: 'Links demo' },
    desc: { en: 'See https://inline.example.com/from-desc for details' },
    tags: [],
    ordered: true,
    visibility: 'public',
    status: 'published',
    origin: 'authored',
    note: 'seed',
    steps: [
      {
        n: 1,
        type: 'step',
        content: {},
        title: { en: 'Step with refs' },
        desc: { en: 'Also inline: [doc](https://inline.example.com/doc).' },
        command: '',
        level: 'required',
        why: {},
        section: {},
        subtasks: [],
        refs: [
          { label: { en: 'Guide' }, url: 'https://Ref.Example.com:443/guide#top' },
          { label: { en: 'No url' } },
        ],
        imageRef: null,
      },
      {
        n: 2,
        type: 'product',
        content: { title: 'Shop', items: [{ name: 'Thing', url: 'https://shop.example.com/item?id=1' }] },
        title: { en: 'Products' },
        desc: {},
        command: '',
        level: 'required',
        why: {},
        section: {},
        subtasks: [],
        refs: [],
        imageRef: null,
      },
    ],
  })
  templateId = list.id
})
afterAll(wipe)

describe('harvestTemplate', () => {
  it('собирает refs + product + инлайн-markdown (desc шага и списка), нормализует URL', async () => {
    const n = await harvestTemplate(templateId)
    expect(n).toBe(4) // ref + product + 2 inline (desc шага, desc списка)
    const occ = await db.select().from(linkOccurrences).where(eq(linkOccurrences.templateId, templateId))
    const bySource = Object.fromEntries(occ.map((o) => [o.source, o.urlNorm]))
    expect(bySource.ref).toBe('https://ref.example.com/guide') // норм: lower host, без :443 и #fragment
    expect(bySource.product).toBe('https://shop.example.com/item?id=1') // query сохранён
    expect(occ.filter((o) => o.source === 'inline').map((o) => o.urlNorm).sort()).toEqual([
      'https://inline.example.com/doc',
      'https://inline.example.com/from-desc',
    ])
    // Уникальные URL заведены в link_checks (непроверенными).
    const checks = await db.select().from(linkChecks)
    expect(checks).toHaveLength(4)
    expect(checks.every((c) => c.verdict === null)).toBe(true)
  })

  it('повторный харвест идемпотентен (delete+insert, дубликатов нет)', async () => {
    await harvestTemplate(templateId)
    const occ = await db.select().from(linkOccurrences).where(eq(linkOccurrences.templateId, templateId))
    expect(occ).toHaveLength(4)
  })
})

describe('runLinkcheckSweep с инжектированной пробой', () => {
  it('выключен по умолчанию — не пробует', async () => {
    clearLinkcheckCache()
    const r = await runLinkcheckSweep({ chained: true }, async () => ({ status: 200 }))
    expect(r.probed).toBe(0)
  })

  it('404 эскалирует в broken только за brokenFails свипов; 200 сбрасывает', async () => {
    await db.insert(appSettings).values([
      { key: 'linkcheck.enabled', value: 'true' },
      { key: 'linkcheck.broken_fails', value: '2' },
      // Politeness: три свипа dead-хоста идут за миллисекунды. Ёмкость bucket теперь =
      // perHostPerMin (не хардкод 2), так что 60 даёт запас на 3 пробы без троттлинга —
      // вердикт не застрянет на broken из-за отложенной пробы. NB: значение обязано
      // быть в валидном диапазоне настройки (1..60) — прежние «600000» молча клэмпились
      // в дефолт 6, из-за чего ёмкость была мала и третий свип троттлился (флейк CI).
      { key: 'linkcheck.per_host_per_min', value: '60' },
    ])
    clearLinkcheckCache()
    const dead = 'https://ref.example.com/guide'
    const probe = async (url: string) => ({ status: url === dead ? 404 : 200 })

    // Свип 1: все due. dead → unreachable (кандидат 1/2), остальные ok.
    const r1 = await runLinkcheckSweep({ chained: true }, probe)
    expect(r1.probed).toBe(4)
    let [row] = await db.select().from(linkChecks).where(eq(linkChecks.urlNorm, dead))
    expect(row.verdict).toBe('unreachable')
    expect(row.failCount).toBe(1)

    // Свип 2: возвращаем dead в due → broken (2/2).
    await db.update(linkChecks).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(linkChecks.urlNorm, dead))
    await runLinkcheckSweep({ chained: true }, probe)
    ;[row] = await db.select().from(linkChecks).where(eq(linkChecks.urlNorm, dead))
    expect(row.verdict).toBe('broken')

    // Сайт ожил → ok, счётчик обнулён.
    await db.update(linkChecks).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(linkChecks.urlNorm, dead))
    await runLinkcheckSweep({ chained: true }, async () => ({ status: 200 }))
    ;[row] = await db.select().from(linkChecks).where(eq(linkChecks.urlNorm, dead))
    expect(row.verdict).toBe('ok')
    expect(row.failCount).toBe(0)
  })
})
