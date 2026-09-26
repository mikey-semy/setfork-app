import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, templates, users } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЯЗЫК ОРИГИНАЛА НОВОГО СПИСКА — НА ЕДИНОЙ ТОЧКЕ СОЗДАНИЯ (ADR-0030).
 *
 * Правило: известный язык содержимого (генерация, форк, MCP) → запасной вариант (язык, на
 * котором автор пишет, или уверенная догадка по тексту). Не код ISO 639-1 — не пишем: пусто лучше
 * неверного. Через настоящее ядро: фасад ставит язык после вставки, и тест обязан видеть строку.
 */
let plain = ''
let n = 0

beforeAll(async () => {
  await resetTables([templates, users])
  const [a] = await db.insert(users).values({ handle: 'lang-plain' }).returning({ id: users.id })
  plain = a.id
})

async function create(ownerId: string, extra: { lang?: string | null; langFallback?: string | null; langFromContent?: boolean }) {
  const list = await listStore.create({
    ownerId,
    slug: `lang-${++n}`,
    title: { ru: 'Суп' },
    desc: {},
    tags: [],
    ordered: true,
    visibility: 'private',
    status: 'draft',
    origin: 'authored',
    note: 'seed',
    steps: [],
    ...extra,
  })
  const [row] = await db.select({ lang: templates.lang }).from(templates).where(eq(templates.id, list.id))
  return row.lang
}

describe('язык оригинала при создании', () => {
  it('известный язык содержимого главнее запасного', async () => {
    expect(await create(plain, { lang: 'ru', langFallback: 'en' })).toBe('ru')
  })

  it('не известен — запасной: язык, на котором автор пишет', async () => {
    expect(await create(plain, { langFallback: 'ru' })).toBe('ru')
  })

  it('⚠️ не код ISO 639-1 — не пишется: пусто лучше неверного', async () => {
    expect(await create(plain, { lang: 'russian', langFallback: 'xx' })).toBeNull()
  })

  it('⚠️ язык задан только содержимым (копия): не задан — пусто, запасной НЕ берём', async () => {
    expect(await create(plain, { lang: null, langFromContent: true, langFallback: 'ru' })).toBeNull()
  })

  it('ничего не известно — пусто (язык угадают по алфавиту)', async () => {
    expect(await create(plain, {})).toBeNull()
  })
})
