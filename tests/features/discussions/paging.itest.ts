import { beforeEach, describe, expect, it } from 'vitest'
import { pageWindow } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ОБСУЖДЕНИЯ СПИСКА — Фаза 2: номера страниц. Каталог, а не лента: их фильтруют по
 * разделу и ищут по названию. Раньше выдача шла без предела и без доопределения порядка.
 *
 * Проверяется то же, что у задач и правок: счёт и выдача считают ОДИН отбор, иначе
 * листалка нарисует страницы, которых нет.
 */

const { db, discussions, templates, users } = await import('@/shared/db')
const { countDiscussions, getDiscussions } = await import('@/features/discussions/queries')

const GENERAL = 7
const IDEAS = 3
const PER = 3
let templateId = ''

beforeEach(async () => {
  await resetTables([discussions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'disc-owner' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'disc-list', title: { ru: 'о' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  await db.insert(discussions).values([
    ...Array.from({ length: GENERAL }, (_, i) => ({
      templateId,
      number: i + 1,
      title: `общее ${i}`,
      authorId: u.id,
      category: 'general',
      // ОДНО время на все: порядок держится только доопределением до id.
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, 0)),
    })),
    ...Array.from({ length: IDEAS }, (_, i) => ({
      templateId,
      number: GENERAL + i + 1,
      title: `идея ${i}`,
      authorId: u.id,
      category: 'ideas',
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, 0)),
    })),
  ])
})

const walk = async (opts: { category?: string; q?: string }, total: number): Promise<string[]> => {
  const seen: string[] = []
  for (let p = 1; p <= Math.max(1, Math.ceil(total / PER)); p++) {
    seen.push(...(await getDiscussions(templateId, opts, pageWindow(p, PER))).map((d) => d.id))
  }
  return seen
}

describe('обсуждения листаются страницами', () => {
  it('счёт и выдача считают ОДИН отбор', async () => {
    const total = await countDiscussions(templateId)
    expect(total).toBe(GENERAL + IDEAS)
    const seen = await walk({}, total)
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
  })

  it('раздел учитывается И в счёте, И в выдаче', async () => {
    const total = await countDiscussions(templateId, { category: 'ideas' })
    expect(total).toBe(IDEAS)
    const seen = await walk({ category: 'ideas' }, total)
    expect(seen).toHaveLength(IDEAS)
  })

  it('поиск по названию учитывается И в счёте, И в выдаче', async () => {
    const total = await countDiscussions(templateId, { q: 'идея' })
    expect(total).toBe(IDEAS)
    expect(await walk({ q: 'идея' }, total)).toHaveLength(IDEAS)
  })

  it('порядок однозначен при РАВНОМ времени', async () => {
    // Время у всех обсуждений равно, значит порядок обязан задаваться id по возрастанию.
    // Проверяем САМ порядок: уникальность сходится и без доопределения, потому что база
    // стабильно отдаёт heap-порядок.
    const seen = await walk({}, await countDiscussions(templateId))
    expect(seen).toEqual([...seen].sort())
  })

  it('битое окно роняет запрос, а не превращается в полный скан', async () => {
    await expect(getDiscussions(templateId, {}, { limit: 0 })).rejects.toThrow(TypeError)
  })
})
