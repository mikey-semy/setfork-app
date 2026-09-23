import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resetTables } from '../../helpers/reset-db'

/**
 * СЦЕНАРИИ И РЕСУРСЫ MCP — КАК ПРОТОКОЛ, на настоящей базе.
 *
 * Сервер — настоящий `McpServer` с нашими `serverOptions` и той же сборкой поверхности, что
 * у маршрута (`registerSurface`); клиент — клиент SDK. Токен пользователя приходит так же,
 * как в проде: `authInfo` рядом с сообщением. Подменён только зритель маршрута экспорта —
 * чтобы сравнить ресурс с ТЕМ ЖЕ текстом, что отдаёт `/{handle}/{slug}/export`.
 */
const viewer = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => viewer.session, requireSession: async () => viewer.session }))
vi.mock('@/shared/i18n/server', async (orig) => ({ ...(await orig()), getLang: async () => 'en' }))

const { db, steps, templateVersions, templates, users } = await import('@/shared/db')
const { registerSurface, serverOptions } = await import('@/features/mcp/registry')
const { GET: exportRoute } = await import('@/app/[handle]/[slug]/export/route')

const ids = { owner: '', other: '' }

async function list(ownerId: string, slug: string, visibility: 'public' | 'private', title: string) {
  // Название на ДВУХ языках: иначе выбор языка ресурса не виден в тексте (откат на
  // единственный перевод даёт одно и то же), и тест «как у экспорта» не отличил бы ru от en.
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: title, ru: `${title} (ru)` }, status: 'published', visibility, currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'initial' }).returning({ id: templateVersions.id })
  await db.insert(steps).values([
    { versionId: v.id, n: 1, title: { en: 'Check disk' }, command: 'df -h', refs: [{ label: { en: 'df' }, url: 'https://man7.org/linux/man-pages/man1/df.1.html' }] },
    { versionId: v.id, n: 2, title: { en: 'Restart app', ru: 'Перезапустить' }, command: 'systemctl restart app', subtasks: [{ en: 'service answers 200' }] },
  ])
}

/** Клиент, подключённый к серверу от имени пользователя `userId` (как токен MCP). */
async function connectAs(userId: string) {
  const server = new McpServer(serverOptions.serverInfo, { capabilities: serverOptions.capabilities, instructions: serverOptions.instructions })
  registerSurface(server as unknown as Parameters<typeof registerSurface>[0])
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const send = clientSide.send.bind(clientSide)
  clientSide.send = (message, options) => send(message, { ...options, authInfo: { token: 't', clientId: 'c', scopes: ['read'], extra: { userId } } })
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(clientSide)
  return client
}

beforeAll(async () => {
  await resetTables([steps, templateVersions, templates, users])
  const [o, x] = await db.insert(users).values([{ handle: 'owner-1' }, { handle: 'other-1' }]).returning({ id: users.id })
  ids.owner = o.id
  ids.other = x.id
  await list(ids.owner, 'public-ops', 'public', 'Public ops')
  await list(ids.owner, 'secret-ops', 'private', 'Secret ops')
})

describe('возможности сервера', () => {
  it('prompts заявлены с listChanged, ресурсы — без него и без подписок', async () => {
    const c = await connectAs(ids.owner)
    const caps = c.getServerCapabilities()
    expect(caps?.prompts).toEqual({ listChanged: true })
    expect(caps?.resources).toEqual({ listChanged: false })
    expect(caps?.resources).not.toHaveProperty('subscribe')
  })
})

describe('сценарии (prompts)', () => {
  it('prompts/list — три сценария', async () => {
    const c = await connectAs(ids.owner)
    const { prompts } = await c.listPrompts()
    expect(prompts.map((p) => p.name).sort()).toEqual(['commitics', 'review-list', 'run-list'])
    expect(prompts.find((p) => p.name === 'run-list')?.arguments).toEqual([
      { name: 'list', description: 'The list: "handle/slug" or its web address', required: true },
    ])
  })

  it('prompts/get без обязательного аргумента — ошибка', async () => {
    const c = await connectAs(ids.owner)
    await expect(c.getPrompt({ name: 'run-list', arguments: {} })).rejects.toThrow()
    await expect(c.getPrompt({ name: 'commitics', arguments: {} })).rejects.toThrow()
  })

  it('run-list: доступный список приложен ресурсом, инструкции — из готовых инструментов', async () => {
    const c = await connectAs(ids.other)
    const r = await c.getPrompt({ name: 'run-list', arguments: { list: 'owner-1/public-ops' } })
    const [text, attached] = r.messages
    expect(text.content.type === 'text' && text.content.text).toMatch(/start_run[\s\S]*check_step[\s\S]*report_run/)
    expect(attached?.content).toMatchObject({ type: 'resource', resource: { uri: 'setfork://lists/owner-1/public-ops', mimeType: 'text/markdown' } })
  })

  it('run-list: чужой приватный список не прикладывается — только инструкция', async () => {
    const c = await connectAs(ids.other)
    const r = await c.getPrompt({ name: 'run-list', arguments: { list: 'owner-1/secret-ops' } })
    expect(r.messages).toHaveLength(1)
  })

  it('review-list и commitics — из готовых инструментов, commitics кончается черновиком', async () => {
    const c = await connectAs(ids.owner)
    const review = await c.getPrompt({ name: 'review-list', arguments: { list: 'owner-1/public-ops', gnome: 'devops' } })
    expect(JSON.stringify(review.messages)).toContain('gnome_review')
    expect(JSON.stringify(review.messages)).toContain('\\"devops\\"')
    const com = await c.getPrompt({ name: 'commitics', arguments: { url: 'https://github.com/a/b/pull/1' } })
    const t = JSON.stringify(com.messages)
    expect(t).toContain('kak-razobrat-chuzhuyu-oshibku-metod-kommitsov')
    expect(t).toContain('create_list')
    expect(t).toContain('PRIVATE DRAFT')
  })
})

describe('ресурсы', () => {
  it('resources/templates/list — шаблон списка', async () => {
    const c = await connectAs(ids.owner)
    const { resourceTemplates } = await c.listResourceTemplates()
    expect(resourceTemplates).toEqual([
      expect.objectContaining({ name: 'list', uriTemplate: 'setfork://lists/{handle}/{slug}', mimeType: 'text/markdown' }),
    ])
  })

  it('resources/read публичного — любому токену, и это тот же текст, что у Markdown-экспорта', async () => {
    const c = await connectAs(ids.other)
    const r = await c.readResource({ uri: 'setfork://lists/owner-1/public-ops' })
    viewer.session = { userId: ids.other, handle: 'other-1' }
    const exported = await (await exportRoute(new Request('http://x/owner-1/public-ops/export?format=md'), { params: Promise.resolve({ handle: 'owner-1', slug: 'public-ops' }) })).text()
    viewer.session = null
    expect(r.contents[0]).toMatchObject({ uri: 'setfork://lists/owner-1/public-ops', mimeType: 'text/markdown' })
    expect((r.contents[0] as { text: string }).text).toBe(exported)
  })

  it('свой приватный — содержимое', async () => {
    const c = await connectAs(ids.owner)
    const r = await c.readResource({ uri: 'setfork://lists/owner-1/secret-ops' })
    expect((r.contents[0] as { text: string }).text).toContain('Secret ops')
  })

  it('чужой приватный — тем же ответом, что несуществующий', async () => {
    const c = await connectAs(ids.other)
    const hidden = await c.readResource({ uri: 'setfork://lists/owner-1/secret-ops' }).catch((e: Error) => e.message)
    const missing = await c.readResource({ uri: 'setfork://lists/owner-1/no-such-list' }).catch((e: Error) => e.message)
    expect(hidden).toContain('List not found or not accessible')
    expect(hidden).toBe(missing)
  })

  it('кривой адрес — ошибка, а не пустой ответ', async () => {
    const c = await connectAs(ids.owner)
    await expect(c.readResource({ uri: 'setfork://lists/owner-1' })).rejects.toThrow()
    await expect(c.readResource({ uri: 'setfork://nothing/here/at-all' })).rejects.toThrow()
  })

  it('resources/list — только свои списки владельца токена, порциями по курсору', async () => {
    // У чужого — ни одного своего: перечень пуст, чужие публичные в него не попадают.
    const other = await connectAs(ids.other)
    expect((await other.listResources()).resources).toEqual([])

    for (let i = 0; i < 22; i++) await list(ids.owner, `bulk-${i}`, 'public', `Bulk ${i}`)
    const c = await connectAs(ids.owner)
    const first = await c.listResources()
    expect(first.resources.length).toBeGreaterThan(0)
    expect(first.nextCursor).toBeTruthy()
    const second = await c.listResources({ cursor: first.nextCursor })
    const all = [...first.resources, ...second.resources].map((r) => r.uri)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(24)
    expect(all).toContain('setfork://lists/owner-1/secret-ops')
    expect(second.nextCursor).toBeUndefined()
  })
})
