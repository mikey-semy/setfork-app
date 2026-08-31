import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, templates, templateVersions, users } from '@/shared/db'

/**
 * МАШИНОЧИТАЕМЫЕ ВЫХОДЫ: одно правило индексации и один рендерер.
 *
 * `llms.txt` и карта сайта отвечают на один вопрос — «что мы предлагаем машинам как
 * готовое», — и обязаны отвечать одинаково. Карта, прячущая породу, и `llms.txt`, её
 * рекламирующий, — противоречие в один шаг, и заметить его было бы некому: оба файла
 * читают не люди.
 *
 * `.md`-суффикс обязан отдавать ТО ЖЕ, что экспорт: второй вариант markdown означал бы,
 * что агент, прочитавший список по ссылке, получил не то, что скачал бы кнопкой.
 */
const OWNER = 'lm-owner'
const ctx: Record<string, string> = {}

vi.mock('@/features/collections/queries', () => ({ getCollections: async () => [] }))

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  ctx.owner = u.id
})

async function published(slug: string, level: 'rock' | 'crystal', desc?: string) {
  const [t] = await db
    .insert(templates)
    .values({
      ownerId: ctx.owner,
      slug,
      title: { en: slug },
      desc: desc ? { en: desc } : undefined,
      currentVersion: 1,
      visibility: 'public',
      status: 'published',
      moderation: 'active',
      starsCount: level === 'crystal' ? 10 : 1,
    })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: t.id, version: 1, verificationLevel: level })
  return t.id
}

describe('llms.txt', () => {
  it('перечисляет ТО ЖЕ, что карта сайта — и это проверяется вызовом карты', async () => {
    await published('lm-good', 'crystal')
    await published('lm-rock', 'rock')

    const { GET } = await import('@/app/llms.txt/route')
    const text = await (await GET()).text()
    // ⚠️ КАРТА ВЫЗЫВАЕТСЯ, а не упоминается. Раньше «соответствие карте» жило только в
    // названии теста и в докблоке: `sitemap()` не звался ни разу, и разойтись эти два
    // файла могли молча — ровно то, против чего тест написан.
    const { default: sitemap } = await import('@/app/sitemap')
    const urls = (await sitemap()).map((e) => e.url)

    for (const slug of ['lm-good', 'lm-rock']) {
      const inMap = urls.some((u) => u.endsWith(`/${OWNER}/${slug}`))
      const inLlms = text.includes(`/${OWNER}/${slug}`)
      expect(inLlms, `«${slug}»: карта и llms.txt обязаны отвечать одинаково`).toBe(inMap)
    }
    // И обе стороны непусты — иначе равенство выполнялось бы на пустоте.
    expect(urls.some((u) => u.endsWith(`/${OWNER}/lm-good`)), 'карта пуста — сравнивать нечего').toBe(true)
  })

  it('описание в две строки НЕ ломает формат и не даёт дописать запись', async () => {
    // ⚠️ Файл агенты читают как ЗАЯВЛЕНИЕ САЙТА о себе, а описание правит автор. Формат
    // строчный: перевод строки внутри описания разрывал запись надвое, и второй кусок
    // читался как отдельный пункт списка — то есть автор мог вписать в наш машинный
    // файл всё, что угодно.
    await published('lm-multiline', 'crystal', 'первая строка\nВТОРАЯ СТРОКА ПОДДЕЛКИ')

    const { GET } = await import('@/app/llms.txt/route')
    const text = await (await GET()).text()
    const listLines = text
      .split('\n')
      .filter((l) => l.startsWith(`- [`) && l.includes(`/${OWNER}/`))

    expect(listLines.length, 'строк в секции ровно столько, сколько списков').toBe(
      listLines.filter((l) => l.includes(`(${'http'}`)).length,
    )
    expect(text).not.toMatch(/^ВТОРАЯ СТРОКА ПОДДЕЛКИ/m)
  })

  it('первой строкой — что это за сайт, а не похвала ему', async () => {
    const { GET } = await import('@/app/llms.txt/route')
    const lines = (await (await GET()).text()).split('\n')
    expect(lines[0]).toBe('# SetFork')
    // Позиционирование: версия — это байты. Без него агент считает ссылку неподвижной.
    expect(lines.slice(0, 6).join(' ')).toMatch(/fixed set of bytes/)
  })
})

describe('llms-full.txt', () => {
  it('вкладывает содержимое ТЕМ ЖЕ рендерером, что экспорт', async () => {
    // Не два независимых снимка, а сравнение выводов: расхождение между ними и есть то,
    // что этот тест обязан ловить.
    await published('lm-inline', 'crystal')
    const { GET } = await import('@/app/llms-full.txt/route')
    const full = await (await GET()).text()

    const { getTemplateDetail } = await import('@/features/library/queries')
    const { toExportList, toMarkdown } = await import('@/features/library/export')
    const detail = await getTemplateDetail(OWNER, 'lm-inline')
    const expected = toMarkdown(toExportList(detail!), 'en')

    expect(full).toContain(expected)
  })
})
