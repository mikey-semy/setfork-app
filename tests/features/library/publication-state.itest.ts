import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Состояние публикации нового списка — часть ЗАПИСИ, а не пост-эффект.
//
// Было: ядро создавало публичный список с moderation='active', а гейт премодерации
// переводил его в 'pending' отдельным апдейтом ПОСЛЕ успешной записи. Между этими
// шагами публичный форк недоверенного автора был виден всем, а при любой ошибке гейта
// (он их глушит намеренно) оставался виден навсегда — карточка ревью fork/page.tsx 005.
//
// Здесь проверяется фронтовая половина цепочки: фасад listStore.create решает состояние
// ДО записи и передаёт его в ядро значением вставки. Запись в ядро подменена: настоящее
// ядро в юнит-окружении не поднято, поэтому мок ЗАПИСЫВАЕТ строку сам — ровно тем
// значением, которое ему передали (как это делает create в setfork-core; парный тест
// там — create_writes_moderation_with_the_row). Так видно и переданное значение, и то,
// что публичная проекция про него думает.
const h = vi.hoisted(() => ({
  apiKey: 'test-key' as string | null,
  created: [] as { moderation?: string }[],
  /** true — мок пишет строку так, как это делала бы сборка ядра БЕЗ поля moderation. */
  coreIgnoresModeration: false,
  session: null as null | { userId: string; handle: string },
  /** Была ли строка видна публичной проекции в МОМЕНТ вставки (см. мок ядра). */
  visibleAtBirth: [] as { id: string; visible: boolean }[],
}))

vi.mock('@/shared/settings/ai', () => ({
  getApiKey: async () => h.apiKey,
  getAiSettings: async () => ({ enabled: true }),
}))

vi.mock('@/features/library/list-store.remote', async () => {
  const { db: database, templates: tpl, templateVersions: vers } = await import('@/shared/db')
  return {
    listReadRemote: {},
    listWriteRemote: {
      async create(input: Record<string, unknown>) {
        h.created.push(input as { moderation?: string })
        const [row] = await database
          .insert(tpl)
          .values({
            ownerId: input.ownerId as string,
            slug: input.slug as string,
            title: input.title as Record<string, string>,
            desc: (input.desc ?? {}) as Record<string, string>,
            tags: (input.tags ?? []) as string[],
            visibility: input.visibility as 'public' | 'private',
            status: input.status as 'draft' | 'published',
            origin: input.origin as 'authored' | 'forked' | 'ai_draft',
            forkedFromId: (input.forkedFromId ?? null) as string | null,
            // Ровно как ядро: пустое/незаданное значение = дефолт схемы ('active').
            ...(input.moderation && !h.coreIgnoresModeration
              ? { moderation: input.moderation as 'active' | 'pending' }
              : {}),
          })
          .returning()
        await database.insert(vers).values({ templateId: row.id, version: 1, note: 'initial' })
        // Замер В МОМЕНТ РОЖДЕНИЯ строки: видна ли она публичной проекции прямо сейчас,
        // до всего, что вызывающий сделает после. Конечное состояние на этот вопрос не
        // отвечает — «догоняющий» апдейт приводит к тому же итогу, просто позже.
        const { getFeed: feedNow } = await import('@/features/library/queries')
        const seen = new Set((await feedNow({}, undefined)).map((r) => r.id))
        h.visibleAtBirth.push({ id: row.id, visible: seen.has(row.id) })
        return { ...row, currentVersion: 1 }
      },
      async addVersion() {
        throw new Error('not used')
      },
    },
  }
})

// Очередь СЛОМАНА весь тест: постановка проверки — пост-эффект, и от неё не должно
// зависеть, публичен список или нет.
vi.mock('@/shared/jobs/queue', () => ({
  enqueueJob: async () => {
    throw new Error('queue is down')
  },
}))

// Окружение серверного экшена forkTemplate (сценарий карточки целиком, а не только
// фасад): сессия, переходы и посторонние эффекты — заглушками, БД и модерация настоящие.
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('@/features/notifications/notify', () => ({ notify: async () => {}, notifyMany: async () => {}, notifyMentions: async () => {} }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: async () => {}, enqueueLinkCheck: async () => {} }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/media', () => ({ avatarSrc: async () => null, imageUrl: () => null, isS3Configured: () => false }))

const { db, jobs, templates, templateVersions, users } = await import('@/shared/db')
const { listStore, registerAfterVersion } = await import('@/features/library/list-store')
const { recheckList } = await import('@/features/moderation/moderate-list')
const { initialModeration } = await import('@/shared/moderation/publication-state')
const { getFeed } = await import('@/features/library/queries')

// Барьер модерации навешивает composition root (instrumentation) — в тесте
// связываем ту же пару, иначе проверялась бы половина боевой сборки.
registerAfterVersion(recheckList)

let ownerId = ''
let curatedId = ''

const newList = (over: Record<string, unknown> = {}) => ({
  ownerId,
  slug: `p-${Math.random().toString(36).slice(2, 8)}`,
  title: { en: 'P' },
  desc: {},
  tags: [],
  ordered: true,
  visibility: 'public' as const,
  status: 'published' as const,
  origin: 'forked' as const,
  note: 'initial',
  steps: [],
  ...over,
})

beforeEach(async () => {
  await db.execute(sql`truncate table ${jobs}, ${templateVersions}, ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'ps-owner' }).returning({ id: users.id })
  const [c] = await db.insert(users).values({ handle: 'ps-curated', curated: true }).returning({ id: users.id })
  ownerId = o.id
  curatedId = c.id
  h.apiKey = 'test-key'
  h.created = []
  h.coreIgnoresModeration = false
  h.session = null
  h.visibleAtBirth = []
})
afterAll(async () => {
  await db.execute(sql`truncate table ${jobs}, ${templateVersions}, ${templates}, ${users} restart identity cascade`)
})

const modOf = async (id: string) =>
  (await db.query.templates.findFirst({ where: (t, { eq: e }) => e(t.id, id) }))?.moderation

describe('listStore.create — состояние публикации приезжает вместе со строкой', () => {
  it('публичный список недоверенного автора рождается pending и не виден в ленте — при сломанной очереди', async () => {
    const list = await listStore.create(newList())

    expect(h.created.at(-1)?.moderation).toBe('pending') // решение принято ДО записи
    expect(h.visibleAtBirth.at(-1)?.visible).toBe(false) // и строка родилась уже скрытой
    expect(await modOf(list.id)).toBe('pending')
    const feed = new Set((await getFeed({}, undefined)).map((r) => r.id))
    expect(feed.has(list.id)).toBe(false)
    // Очередь падала весь вызов — на состояние публикации это не повлияло.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs)
    expect(n).toBe(0)
  })

  it('доверенный автор публикуется сразу: active и виден в ленте', async () => {
    const list = await listStore.create(newList({ ownerId: curatedId }))

    expect(h.created.at(-1)?.moderation).toBe('active')
    expect(await modOf(list.id)).toBe('active')
    const feed = new Set((await getFeed({}, undefined)).map((r) => r.id))
    expect(feed.has(list.id)).toBe(true)
  })

  it('приватный список и черновик модерацию не проходят — они наружу не выставлены', async () => {
    const priv = await listStore.create(newList({ visibility: 'private' }))
    const draft = await listStore.create(newList({ status: 'draft' }))

    expect(await modOf(priv.id)).toBe('active')
    expect(await modOf(draft.id)).toBe('active')
  })

  it('без ИИ-ключа гейта нет (dev/стенды): список остаётся видимым', async () => {
    h.apiKey = null
    const list = await listStore.create(newList())

    expect(h.created.at(-1)?.moderation).toBe('active')
    expect(await modOf(list.id)).toBe('active')
  })
})

describe('initialModeration — правило доверия автору', () => {
  const pub = { visibility: 'public' as const, status: 'published' as const }

  it('три СВОИХ живых публичных списка без нарушений → автор доверенный', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(templates).values({ ownerId, slug: `own-${i}`, title: { en: 'O' }, origin: 'authored' })
    }
    expect(await initialModeration({ ownerId, ...pub })).toBe('active')
  })

  it('форки чужих списков доверия не дают', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(templates).values({ ownerId, slug: `fork-${i}`, title: { en: 'F' }, origin: 'forked' })
    }
    expect(await initialModeration({ ownerId, ...pub })).toBe('pending')
  })

  it('нарушение в истории отменяет доверие', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(templates).values({ ownerId, slug: `ok-${i}`, title: { en: 'O' }, origin: 'authored' })
    }
    await db.insert(templates).values({ ownerId, slug: 'bad', title: { en: 'B' }, origin: 'authored', moderation: 'flagged' })
    expect(await initialModeration({ ownerId, ...pub })).toBe('pending')
  })
})

describe('gateListPublication — публикация уже существующего списка', () => {
  it('исключает сам публикуемый список из счёта доверия', async () => {
    // Три своих живых списка + четвёртый, который сейчас публикуется: он не должен
    // считаться в собственный зачёт (иначе доверие зависело бы от порядка проверок).
    for (let i = 0; i < 3; i++) {
      await db.insert(templates).values({ ownerId, slug: `g-${i}`, title: { en: 'G' }, origin: 'authored' })
    }
    const [subject] = await db
      .insert(templates)
      .values({ ownerId, slug: 'subject', title: { en: 'S' }, origin: 'authored' })
      .returning({ id: templates.id })
    const { gateListPublication } = await import('@/features/moderation/moderate-list')
    await gateListPublication(subject.id)
    expect(await modOf(subject.id)).toBe('active')

    // А автор без истории — в pending, даже если очередь недоступна.
    const [fresh] = await db.insert(users).values({ handle: 'ps-fresh' }).returning({ id: users.id })
    const [theirs] = await db
      .insert(templates)
      .values({ ownerId: fresh.id, slug: 'theirs', title: { en: 'T' }, origin: 'authored' })
      .returning({ id: templates.id })
    await gateListPublication(theirs.id)
    expect(await modOf(theirs.id)).toBe('pending')
  })

  it('flagged не отмывается повторной публикацией', async () => {
    const [row] = await db
      .insert(templates)
      .values({ ownerId, slug: 'flagged', title: { en: 'F' }, moderation: 'flagged' })
      .returning({ id: templates.id })
    const { gateListPublication } = await import('@/features/moderation/moderate-list')
    await gateListPublication(row.id)
    expect(await modOf(row.id)).toBe('flagged')
  })
})

describe('окно выкатки: ядро без поля moderation', () => {
  it('потерянное ядром состояние восстанавливается апдейтом, а не остаётся публичным', async () => {
    // Эмуляция старой сборки ядра: поле в запросе есть, но записывается дефолт схемы.
    h.coreIgnoresModeration = true
    const list = await listStore.create(newList())

    expect(h.created.at(-1)?.moderation).toBe('pending') // решение принято и отправлено
    expect(await modOf(list.id)).toBe('pending') // и доведено до строки, раз ядро его потеряло
    const feed = new Set((await getFeed({}, undefined)).map((r) => r.id))
    expect(feed.has(list.id)).toBe(false)
  })
})

describe('forkTemplate — сценарий карточки целиком', () => {
  it('публичный форк недоверенного автора не появляется в ленте ни на мгновение', async () => {
    // Источник: чужой публичный список с одной версией.
    const [author] = await db.insert(users).values({ handle: 'ps-author' }).returning({ id: users.id })
    const [src] = await db
      .insert(templates)
      .values({ ownerId: author.id, slug: 'source', title: { ru: 'Источник' }, origin: 'authored' })
      .returning({ id: templates.id })
    await db.insert(templateVersions).values({ templateId: src.id, version: 1, note: 'initial' })

    h.session = { userId: ownerId, handle: 'ps-owner' }
    const { forkTemplate } = await import('@/features/library/actions')
    await expect(forkTemplate(src.id)).rejects.toThrow(/REDIRECT:/) // успех экшена = переход на форк

    const fork = await db.query.templates.findFirst({
      where: (t, { eq: e }) => e(t.forkedFromId, src.id),
    })
    expect(fork?.moderation).toBe('pending')
    // Главное утверждение карточки: НИ В ОДИН МОМЕНТ. Конечное состояние даёт то же
    // самое и у старого кода — он доводил список до pending апдейтом после вставки;
    // разница видна только в замере, снятом в момент рождения строки.
    expect(h.visibleAtBirth.at(-1)).toEqual({ id: fork!.id, visible: false })
    const feed = new Set((await getFeed({}, undefined)).map((r) => r.id))
    expect(feed.has(fork!.id)).toBe(false)
    expect(feed.has(src.id)).toBe(true) // сам источник видимости не терял
  })
})

describe('никто не остаётся без проверки', () => {
  it('строка pending видна только владельцу и админу', async () => {
    const list = await listStore.create(newList())
    const [other] = await db.insert(users).values({ handle: 'ps-other' }).returning({ id: users.id })

    const forOther = new Set((await getFeed({}, other.id)).map((r) => r.id))
    const forOwner = new Set((await getFeed({}, ownerId)).map((r) => r.id))
    expect(forOther.has(list.id)).toBe(false)
    expect(forOwner.has(list.id)).toBe(true)

    // Санити: строка действительно создана и лежит в БД (тест не про пустую выборку).
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(templates)
      .where(and(eq(templates.id, list.id), eq(templates.moderation, 'pending')))
    expect(n).toBe(1)
  })
})
