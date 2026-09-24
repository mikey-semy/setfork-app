import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../helpers/reset-db'

/**
 * OPENAPI — «КАЖДЫЙ ПУТЬ ОТВЕЧАЕТ»: каждый описанный адрес вызывается на настоящем
 * публичном списке, и код ответа обязан быть среди объявленных в документе. Второй
 * вызов — на несуществующем списке: отказ обязан быть объявленным 404.
 */
vi.mock('@/shared/auth/session', () => ({ getSession: async () => null }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))

const { db, steps, templateVersions, templates, users } = await import('@/shared/db')
const { openApiDocument } = await import('@/app/openapi.json/document')

// У маршрутов разные типы параметров пути; тест зовёт их единообразно.
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response
const HANDLERS: Record<string, () => Promise<{ GET: unknown }>> = {
  '/{handle}/{slug}/data.json': () => import('@/app/[handle]/[slug]/data.json/route'),
  '/{handle}/{slug}/raw': () => import('@/app/[handle]/[slug]/raw/route'),
  '/{handle}/{slug}/export': () => import('@/app/[handle]/[slug]/export/route'),
  '/{handle}/{slug}/SKILL.md': () => import('@/app/[handle]/[slug]/SKILL.md/route'),
  '/{handle}/{slug}/skill.tar.gz': () => import('@/app/[handle]/[slug]/skill.tar.gz/route'),
  '/{handle}/{slug}/releases.atom': () => import('@/app/[handle]/[slug]/releases.atom/route'),
  '/{handle}/{slug}/repo.bundle': () => import('@/app/[handle]/[slug]/repo.bundle/route'),
  '/{handle}/{slug}/badge/{kind}': () => import('@/app/[handle]/[slug]/badge/[kind]/route'),
  '/{handle}/{slug}/embed': () => import('@/app/[handle]/[slug]/embed/route'),
}

const OWNER = 'oa-owner'
const doc = openApiDocument()

beforeAll(async () => {
  await resetTables([steps, templateVersions, templates, users])
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: o.id, slug: 'deploy', title: { en: 'Deploy' }, status: 'published', visibility: 'public', currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: 'Check' }, command: 'echo ok' })
})

async function call(path: string, slug: string) {
  const GET = (await HANDLERS[path]()).GET as Handler
  const params: Record<string, string> = { handle: OWNER, slug, kind: 'stars.svg' }
  const url = `https://setfork.test${path.replace('{handle}', OWNER).replace('{slug}', slug).replace('{kind}', 'stars.svg')}`
  return GET(new Request(url), { params: Promise.resolve(params) })
}

describe('каждый путь из openapi.json отвечает объявленным кодом', () => {
  it('для каждого пути есть обработчик в этом тесте', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(Object.keys(doc.paths).sort())
  })

  it.each(Object.keys(HANDLERS))('%s — на публичном списке', async (path) => {
    const res = await call(path, 'deploy')
    const declared = Object.keys((doc.paths as Record<string, { get: { responses: Record<string, unknown> } }>)[path].get.responses)
    expect(declared, `ответ ${res.status} не объявлен`).toContain(String(res.status))
    expect(res.status).toBe(200)
  })

  it.each(Object.keys(HANDLERS))('%s — несуществующий список: объявленный 404 объявленного вида', async (path) => {
    const res = await call(path, 'no-such-list')
    expect(res.status).toBe(404)
    // Тип тела — тот, что объявлен в документе для 404: Problem Details везде, кроме
    // встраивания (там HTML — его показывает человеку iframe).
    const declared = Object.keys(((doc.paths as Record<string, { get: { responses: Record<string, { content?: Record<string, unknown> }> } }>)[path].get.responses['404'].content ?? {}))
    expect(declared.some((m) => (res.headers.get('content-type') ?? '').startsWith(m)), `${res.headers.get('content-type')} ∉ ${declared}`).toBe(true)
  })
})
