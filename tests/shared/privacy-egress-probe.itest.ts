import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appSettings, db, embeddings, steps, templates, templateVersions, users } from '@/shared/db'

// ЛИНЗА 04 · пробник «что уезжает наружу»: настоящий путь индексации (reindexList →
// embedTexts) с ПЕРЕХВАЧЕННЫМ fetch. Смотрим не код, а тело исходящего запроса:
// какой хост, какие заголовки, какой текст. Плюс — что осело в корпусе.

const SECRET = 'ЗАКРЫТЫЙ-ТЕКСТ-9F3A'
const SECRET_STEP = 'секретный шаг: ключ от сейфа под ковриком'

interface Captured {
  url: string
  headers: Record<string, string>
  body: { model?: string; input?: string[]; dimensions?: number }
}
const calls: Captured[] = []

const fakeVec = () => new Array<number>(768).fill(0).map((_, i) => (i === 0 ? 1 : 0))

beforeAll(async () => {
  await db.execute(sql`truncate table ${embeddings}, ${templates}, ${users}, ${appSettings} restart identity cascade`)

  // Провайдер ЧАТА — Яндекс (RU-контур), ключ эмбеддингов — OpenRouter.
  await db.insert(appSettings).values([
    { key: 'ai.provider', value: 'yandex' },
    { key: 'ai.yandex_api_key', value: 'yc-key-test' },
    { key: 'ai.yandex_folder_id', value: 'folder-test' },
    { key: 'ai.api_key', value: 'sk-or-v1-test' },
  ])

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = init?.body ? (JSON.parse(String(init.body)) as Captured['body']) : {}
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body })
    const n = body.input?.length ?? 1
    return new Response(
      JSON.stringify({
        data: Array.from({ length: n }, (_, i) => ({ embedding: fakeVec(), index: i })),
        usage: { total_tokens: 42 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await db.execute(sql`truncate table ${embeddings}, ${templates}, ${users}, ${appSettings} restart identity cascade`)
})

async function seedList(slug: string, visibility: 'public' | 'private'): Promise<string> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, 'eg-owner')).limit(1)
  const ownerId = u ? u.id : (await db.insert(users).values({ handle: 'eg-owner' }).returning({ id: users.id }))[0].id
  const [tpl] = await db
    .insert(templates)
    .values({
      ownerId,
      slug,
      title: { ru: `${SECRET} ${slug}` },
      desc: { ru: 'описание закрытого списка' },
      visibility,
      status: 'published',
      currentVersion: 1,
    })
    .returning({ id: templates.id })
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: 1 })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: ver.id, n: 1, type: 'step', title: { ru: SECRET_STEP }, desc: { ru: '' } })
  return tpl.id
}

describe('линза 04 · эмбеддинги: что уезжает провайдеру и что оседает в корпусе', () => {
  it('плейнтекст ПРИВАТНОГО списка уходит на openrouter.ai, хотя чат-провайдер — Яндекс', async () => {
    const id = await seedList('secret-list', 'private')
    const { reindexList } = await import('@/features/library/reindex')
    calls.length = 0
    await reindexList(id)

    expect(calls.length).toBeGreaterThan(0)
    const embedCall = calls.find((c) => c.url.includes('/embeddings'))!
    expect(embedCall).toBeTruthy()
    // 1. Хост — США, а не RU-контур выбранного чат-провайдера.
    expect(embedCall.url).toBe('https://openrouter.ai/api/v1/embeddings')
    // 2. В теле — ПОЛНЫЙ текст приватного списка, включая шаг.
    const sent = (embedCall.body.input ?? []).join('\n')
    expect(sent).toContain(SECRET)
    expect(sent).toContain(SECRET_STEP)
    // 3. Заголовков «не логировать / не обучаться» нет ни одного.
    const hk = Object.keys(embedCall.headers).map((k) => k.toLowerCase())
    expect(hk).not.toContain('x-data-logging-enabled')
    expect(JSON.stringify(embedCall.body)).not.toContain('data_collection')
    // 4. Зато уезжает идентификация стенда.
    expect(hk).toContain('http-referer')
  })

  it('в корпус плейнтекст приватного НЕ пишется (вектор — пишется)', async () => {
    const [row] = await db
      .select({ content: embeddings.content, metadata: embeddings.metadata, hasVec: sql<boolean>`${embeddings.embedding} is not null` })
      .from(embeddings)
      .limit(1)
    expect(row.content).toBe('')
    expect(row.metadata).toEqual({ private: true })
    expect(row.hasVec).toBe(true)
  })

  it('НА ЯНДЕКС-ПУТИ эмбеддингов запрета логирования тоже нет (в отличие от чата)', async () => {
    // Прод-конфигурация: и чат, и эмбеддинги на Яндексе. ВАЖНО: маршрут задаёт не
    // цель (embed.provider), а ПРОСТРАНСТВО ИНДЕКСА — оно пишется полным реиндексом.
    const space = {
      provider: 'yandex',
      docModel: 'emb://folder-test/text-embeddings-v2-doc/latest',
      queryModel: 'emb://folder-test/text-embeddings-v2-query/latest',
      dim: 768,
      at: 1,
    }
    await db.insert(appSettings).values([
      { key: 'embed.provider', value: 'yandex' },
      { key: 'embed.index_space', value: JSON.stringify(space) },
    ])
    const { clearEmbedSpaceCache } = await import('@/shared/ai/embed-space')
    clearEmbedSpaceCache()

    const id = await seedList('yandex-path', 'private')
    const { reindexList } = await import('@/features/library/reindex')
    calls.length = 0
    await reindexList(id)

    const embedCall = calls.find((c) => c.url.includes('/embeddings'))!
    expect(embedCall.url).toContain('ai.api.cloud.yandex.net')
    const sent = (embedCall.body.input ?? []).join('\n')
    expect(sent).toContain(SECRET) // текст приватного списка уезжает и здесь
    const hk = Object.keys(embedCall.headers).map((k) => k.toLowerCase())
    // Чат к Яндексу идёт с 'x-data-logging-enabled: false' (resolveAiProvider),
    // а этот путь строит заголовки сам (embeddings.ts:endpointFor) — и запрет теряет.
    expect(hk).not.toContain('x-data-logging-enabled')
    expect(hk).not.toContain('x-folder-id')
  })

  it('запрет логирования у провайдера: есть только у Яндекса', async () => {
    const { resolveAiProvider } = await import('@/shared/settings/ai')
    const keys = {
      'ai.yandex_api_key': 'k',
      'ai.yandex_folder_id': 'f',
      'ai.api_key': 'k',
      'ai.selectel_api_key': 'k',
      'ai.gigachat_auth_key': 'k',
    }
    const hdrs = (provider: string) => resolveAiProvider({ ...keys, 'ai.provider': provider }, {})?.headers ?? {}
    expect(hdrs('yandex')['x-data-logging-enabled']).toBe('false')
    expect(hdrs('openrouter')).toEqual({})
    expect(hdrs('selectel')).toEqual({})
    expect(hdrs('gigachat')).toEqual({})
  })

  it('смена видимости public→private НЕ переписывает уже осевший плейнтекст', async () => {
    const id = await seedList('was-public', 'public')
    const { reindexList } = await import('@/features/library/reindex')
    await reindexList(id)
    const before = await db.select({ content: embeddings.content }).from(embeddings).where(eq(embeddings.refId, id))
    expect(before.some((r) => r.content.includes(SECRET))).toBe(true)

    // Пользователь закрывает список ровно так, как это делает страница настроек.
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, id))

    const after = await db.select({ content: embeddings.content }).from(embeddings).where(eq(embeddings.refId, id))
    // Если бы стрип был не только «на индексации» — здесь было бы пусто.
    expect(after.some((r) => r.content.includes(SECRET))).toBe(true)
  })
})
