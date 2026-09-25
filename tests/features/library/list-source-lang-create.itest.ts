import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, templates, users } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЯЗЫК ОРИГИНАЛА НОВОГО СПИСКА — НА ЕДИНОЙ ТОЧКЕ СОЗДАНИЯ (ADR-0030).
 *
 * Правило: известный язык содержимого (генерация, форк, MCP) → настройка автора «язык моих
 * списков» → язык, на котором он пишет (интерфейс). Не код ISO 639-1 — не пишем: пусто лучше
 * неверного. Через настоящее ядро: фасад ставит язык после вставки, и тест обязан видеть строку.
 */
let plain = ''
let withSetting = ''
let n = 0

beforeAll(async () => {
  await resetTables([templates, users])
  const [a] = await db.insert(users).values({ handle: 'lang-plain' }).returning({ id: users.id })
  const [b] = await db.insert(users).values({ handle: 'lang-be', listLang: 'be' }).returning({ id: users.id })
  plain = a.id
  withSetting = b.id
})

async function create(ownerId: string, extra: { lang?: string | null; writingLang?: string | null }) {
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
  it('известный язык содержимого главнее настройки автора', async () => {
    expect(await create(withSetting, { lang: 'ru', writingLang: 'en' })).toBe('ru')
  })

  it('не известен — настройка автора главнее языка, на котором он пишет', async () => {
    expect(await create(withSetting, { writingLang: 'ru' })).toBe('be')
  })

  it('нет ни того, ни другого — язык, на котором автор пишет', async () => {
    expect(await create(plain, { writingLang: 'ru' })).toBe('ru')
  })

  it('⚠️ не код ISO 639-1 — не пишется: пусто лучше неверного', async () => {
    expect(await create(plain, { lang: 'russian', writingLang: 'xx' })).toBeNull()
  })

  it('ничего не известно — пусто (язык угадают по алфавиту)', async () => {
    expect(await create(plain, {})).toBeNull()
  })
})
