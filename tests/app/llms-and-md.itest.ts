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

async function published(slug: string, level: 'rock' | 'crystal') {
  const [t] = await db
    .insert(templates)
    .values({
      ownerId: ctx.owner,
      slug,
      title: { en: slug },
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
  it('перечисляет проверенное и НЕ перечисляет породу — как карта сайта', async () => {
    await published('lm-good', 'crystal')
    await published('lm-rock', 'rock')

    const { GET } = await import('@/app/llms.txt/route')
    const text = await (await GET()).text()

    expect(text).toContain(`/${OWNER}/lm-good`)
    expect(text, 'порода не рекламируется агентам — иначе карта и llms.txt противоречат').not.toContain(`/${OWNER}/lm-rock`)
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
