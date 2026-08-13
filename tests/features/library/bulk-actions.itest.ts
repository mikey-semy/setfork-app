import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// ПАКЕТНЫЕ ДЕЙСТВИЯ. Опасность у них ровно в объёме: одно нажатие меняет сотни списков.
// Поэтому тесты держат три вещи — чужое не трогается ни при каком наборе идентификаторов;
// отмена возвращает КАЖДЫЙ список на свою прежнюю полку, а не сваливает всё в одну; и
// публикация не обходит модерацию и не публикует больше, чем проверка успевает за сутки.
//
// Мокаем только границу Next-рантайма (кто вошёл, revalidatePath) — БД и правила настоящие.
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
// Авто-модерация требует ключа модели: без него гейт отвечает «выключен», и проверка
// «ушло на модерацию» проверяла бы отсутствие ключа, а не поведение барьера.
vi.mock('@/shared/settings/ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getApiKey: vi.fn(async () => 'test-key'),
}))

const { db, jobs, repositories, templates, users } = await import('@/shared/db')
const { bulkCreateCatalogAndMove, bulkPublish, bulkRestoreCatalog, bulkSetCatalog } = await import('@/features/library/bulk/actions')
const { PUBLISH_BATCH_MAX } = await import('@/features/library/publish-draft')

let ownerId = ''
let otherId = ''

const seed = async (over: Partial<typeof templates.$inferInsert> = {}): Promise<string> => {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug: `l-${Math.random().toString(36).slice(2)}`, title: { en: 'L' }, ...over })
    .returning({ id: templates.id })
  return row.id
}
const shelf = async (name: string): Promise<string> => {
  const [row] = await db.insert(repositories).values({ ownerId, name, title: { ru: name } }).returning({ id: repositories.id })
  return row.id
}
const rowOf = async (id: string) => (await db.select().from(templates).where(eq(templates.id, id)))[0]

beforeEach(async () => {
  await resetTables([jobs, templates, repositories, users])
  const [o] = await db.insert(users).values({ handle: 'bulk-owner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'bulk-other' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
  h.session = { userId: ownerId, handle: 'bulk-owner' }
})
afterAll(async () => {
  await resetTables([jobs, templates, repositories, users])
})

describe('раскладка по полкам', () => {
  it('чужой список не переезжает, сколько бы его ни присылали', async () => {
    const mine = await seed()
    const [foreign] = await db
      .insert(templates)
      .values({ ownerId: otherId, slug: 'foreign', title: { en: 'F' } })
      .returning({ id: templates.id })
    const cat = await shelf('devops')

    const res = await bulkSetCatalog([mine, foreign.id], 'devops')

    expect(res.changed).toBe(1)
    expect((await rowOf(mine)).repositoryId).toBe(cat)
    expect((await rowOf(foreign.id)).repositoryId).toBeNull()
  })

  it('чужая полка не принимает списки: имя ищется среди СВОИХ', async () => {
    const mine = await seed()
    await db.insert(repositories).values({ ownerId: otherId, name: 'secret', title: { ru: 'secret' } })

    const res = await bulkSetCatalog([mine], 'secret')

    expect(res.error).toBe('catalog-not-found')
    expect((await rowOf(mine)).repositoryId).toBeNull()
  })

  it('отмена возвращает каждый список НА СВОЮ прежнюю полку', async () => {
    const a = await shelf('a')
    const b = await shelf('b')
    await shelf('target')
    const fromA = await seed({ repositoryId: a })
    const fromB = await seed({ repositoryId: b })
    const unfiled = await seed()

    const res = await bulkSetCatalog([fromA, fromB, unfiled], 'target')
    expect(res.changed).toBe(3)
    await bulkRestoreCatalog(res.restore)

    expect((await rowOf(fromA)).repositoryId).toBe(a)
    expect((await rowOf(fromB)).repositoryId).toBe(b)
    expect((await rowOf(unfiled)).repositoryId).toBeNull()
  })

  it('снятие с полки — это тоже раскладка, с возможностью вернуть', async () => {
    const a = await shelf('a')
    const list = await seed({ repositoryId: a })

    const res = await bulkSetCatalog([list], null)
    expect((await rowOf(list)).repositoryId).toBeNull()

    await bulkRestoreCatalog(res.restore)
    expect((await rowOf(list)).repositoryId).toBe(a)
  })

  it('возврат не пускает список на ЧУЖУЮ полку, даже если её id прислали', async () => {
    const [foreignShelf] = await db
      .insert(repositories)
      .values({ ownerId: otherId, name: 'theirs', title: { ru: 'theirs' } })
      .returning({ id: repositories.id })
    const list = await seed()

    await bulkRestoreCatalog([{ catalogId: foreignShelf.id, ids: [list] }])

    expect((await rowOf(list)).repositoryId).toBeNull()
  })

  it('архивное и замороженное пачка не двигает', async () => {
    // Полка — свойство списка, а у архивного свойства не меняются вовсе (`canEditList`).
    // Пачка не может быть лазейкой мимо запрета, который держит одиночная правка.
    const cat = await shelf('devops')
    const archived = await seed({ archivedAt: new Date() })
    const frozen = await seed({ frozenAt: new Date() })
    const normal = await seed()

    const res = await bulkSetCatalog([archived, frozen, normal], 'devops')

    expect(res.changed).toBe(1)
    expect((await rowOf(normal)).repositoryId).toBe(cat)
    expect((await rowOf(archived)).repositoryId).toBeNull()
    expect((await rowOf(frozen)).repositoryId).toBeNull()
  })

  it('раскладка не выдаёт себя за правку содержимого', async () => {
    // Иначе разложил пятьсот списков — и все пятьсот всплыли в лентах «по обновлению» с
    // сегодняшней датой, хотя ни одна буква в них не изменилась.
    await shelf('devops')
    const long = new Date('2020-01-01T00:00:00Z')
    const list = await seed({ updatedAt: long })

    await bulkSetCatalog([list], 'devops')

    expect((await rowOf(list)).updatedAt.toISOString()).toBe(long.toISOString())
  })

  it('новая полка заводится и сразу принимает пачку', async () => {
    const one = await seed()
    const two = await seed()

    const res = await bulkCreateCatalogAndMove([one, two], 'Мои скиллы')

    expect(res.changed).toBe(2)
    const [cat] = await db.select().from(repositories).where(eq(repositories.ownerId, ownerId))
    expect(cat.name).toBe('moi-skilly')
    expect((await rowOf(one)).repositoryId).toBe(cat.id)
  })
})

describe('публикация пачкой', () => {
  it('по умолчанию это ПЛАН: в библиотеке ничего не меняется', async () => {
    const draft = await seed({ status: 'draft', visibility: 'public' })

    const plan = await bulkPublish([draft])

    // Автор пока не доверенный, значит план и обещает проверку, а не мгновенный паблик.
    expect(plan).toMatchObject({ dryRun: true, pending: 1, published: 0 })
    expect((await rowOf(draft)).status).toBe('draft')
  })

  it('план обещает ровно то, что потом произойдёт', async () => {
    // Диалог показывает план, а действие выполняет запись. Если они считаются разными
    // правилами, человек соглашается на одно, а получает другое — и узнаёт об этом, когда
    // отменять поздно. Смешанный набор ловит расхождение по всем трём исходам сразу.
    const held = await seed({ status: 'draft', visibility: 'public' })
    const flagged = await seed({ status: 'draft', visibility: 'public', moderation: 'flagged' })
    const priv = await seed({ status: 'draft', visibility: 'private' })
    const ids = [held, flagged, priv]

    const plan = await bulkPublish(ids)
    const done = await bulkPublish(ids, false)

    expect(plan).toMatchObject({ published: done.published, pending: done.pending, blocked: done.blocked })
    expect(plan).toMatchObject({ published: 1, pending: 1, blocked: 1 })
  })

  it('публикуются только черновики, остальное считается пропущенным', async () => {
    const draft = await seed({ status: 'draft', visibility: 'private' })
    const already = await seed({ status: 'published' })

    const res = await bulkPublish([draft, already], false)

    expect(res).toMatchObject({ skipped: 1 })
    expect((await rowOf(draft)).status).toBe('published')
  })

  it('публичный список уходит на проверку — барьер модерации не обходится', async () => {
    const draft = await seed({ status: 'draft', visibility: 'public' })

    const res = await bulkPublish([draft], false)

    const row = await rowOf(draft)
    expect(row.status).toBe('published')
    expect(row.moderation).toBe('pending')
    // Про «ушёл на проверку» человеку говорят отдельно: список опубликован, но пока
    // виден только ему — молчать об этом нельзя.
    expect(res).toMatchObject({ published: 0, pending: 1 })
    expect((await db.select({ type: jobs.type }).from(jobs)).map((j) => j.type)).toContain('moderate')
  })

  it('снятое модерацией не отмывается пачкой и не выдаётся за «ждёт проверки»', async () => {
    const flagged = await seed({ status: 'draft', visibility: 'public', moderation: 'flagged' })

    const res = await bulkPublish([flagged], false)

    expect((await rowOf(flagged)).moderation).toBe('flagged')
    // Снятый список НЕ ждёт проверку: её не будет, пока не решит админ. Обещать её —
    // значит соврать в единственном месте, где человек про это узнаёт.
    expect(res).toMatchObject({ blocked: 1, pending: 0 })
  })

  it('публичный список не бывает виден раньше барьера: статус и модерация — одной записью', async () => {
    // Пока это были общая запись «все → published» и барьер следом, недоверенный автор
    // успевал показать всем целую пачку, а прерванный запрос оставлял остаток открытым.
    // Проверяем инвариант с другой стороны: НИ ОДИН публичный список пачки не оказывается
    // published+active, даже если барьер прервать.
    const ids = [await seed({ status: 'draft', visibility: 'public' }), await seed({ status: 'draft', visibility: 'public' })]
    const mod = await import('@/features/moderation/moderate-list')
    const gate = vi.spyOn(mod, 'gateListPublication').mockRejectedValueOnce(new Error('прервано'))

    await bulkPublish(ids, false).catch(() => {})
    gate.mockRestore()

    const rows = await db.select({ status: templates.status, moderation: templates.moderation }).from(templates)
    expect(rows.filter((r) => r.status === 'published' && r.moderation === 'active')).toHaveLength(0)
  })

  it('доверенному автору удержание отпускают: список виден сразу', async () => {
    // Обратная сторона предыдущей проверки. Публичный список рождается опубликованным в
    // pending, и если бы барьер не отпускал удержание, доверенные авторы (и стенды без
    // ключа модели) получили бы вечно невидимые списки — цена «fail-closed» была бы
    // сломанной публикацией у всех.
    for (let i = 0; i < 3; i++) await seed({ status: 'published', visibility: 'public', moderation: 'active', origin: 'authored' })
    const fresh = await seed({ status: 'draft', visibility: 'public' })

    const res = await bulkPublish([fresh], false)

    expect((await rowOf(fresh)).moderation).toBe('active')
    expect(res).toMatchObject({ published: 1, pending: 0 })
  })

  it('приватному списку прежняя отметка модерации не переписывается', async () => {
    // Приватный наружу не выставлен — проверять в нём нечего, и трогать его отметку не за что.
    const priv = await seed({ status: 'draft', visibility: 'private', moderation: 'pending' })

    await bulkPublish([priv], false)

    expect((await rowOf(priv)).moderation).toBe('pending')
  })

  it('за раз публикуется не больше суточного предела проверок, и остаток назван', async () => {
    const ids: string[] = []
    for (let i = 0; i <= PUBLISH_BATCH_MAX; i++) ids.push(await seed({ status: 'draft', visibility: 'private' }))

    const res = await bulkPublish(ids, false)

    expect(res.overflow).toBe(1)
    const published = await db.select({ status: templates.status }).from(templates).where(eq(templates.status, 'published'))
    expect(published).toHaveLength(PUBLISH_BATCH_MAX)
  })

  it('снятие админом посреди пачки не затирается', async () => {
    // Пачка читает состояние всех списков ОДИН раз, а пишет по одному. Пока она идёт, админ
    // успевает снять список, которого очередь ещё не дошла. Безусловное «moderation =
    // pending» затёрло бы его решение, а барьер следом отпустил бы удержание доверенному
    // автору — снятое стало бы публичным.
    //
    // Момент «посреди» ловим барьером первого списка: он вызывается уже после того, как
    // состояние второго прочитано, но до того, как оно записано.
    const first = await seed({ status: 'draft', visibility: 'public' })
    const second = await seed({ status: 'draft', visibility: 'public' })
    const mod = await import('@/features/moderation/moderate-list')
    vi.spyOn(mod, 'gateListPublication').mockImplementation(async () => {
      await db.update(templates).set({ moderation: 'flagged' }).where(eq(templates.id, second))
    })

    const res = await bulkPublish([first, second], false)
    vi.restoreAllMocks()

    const row = await rowOf(second)
    expect(row.moderation).toBe('flagged')
    expect(row.status).toBe('draft') // публикация не состоялась вовсе
    expect(res.skipped).toBe(1)
  })

  it('архивное и замороженное не публикуется даже адресно', async () => {
    // Пакетное действие отсекало такое своим отбором, но MCP и кнопка адресуют список
    // напрямую — проверка обязана стоять в общем слое публикации.
    const archived = await seed({ status: 'draft', visibility: 'public', archivedAt: new Date() })
    const frozen = await seed({ status: 'draft', visibility: 'public', frozenAt: new Date() })

    const res = await bulkPublish([archived, frozen], false)

    expect(res).toMatchObject({ published: 0, pending: 0, skipped: 2 })
    expect((await rowOf(archived)).status).toBe('draft')
    expect((await rowOf(frozen)).status).toBe('draft')
  })

  it('чужое не публикуется', async () => {
    const [foreign] = await db
      .insert(templates)
      .values({ ownerId: otherId, slug: 'foreign-draft', title: { en: 'F' }, status: 'draft' })
      .returning({ id: templates.id })

    const res = await bulkPublish([foreign.id], false)

    expect(res.published + res.pending).toBe(0)
    expect((await rowOf(foreign.id)).status).toBe('draft')
  })
})
