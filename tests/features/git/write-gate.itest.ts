import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Линза 02, F3: заморозка и архив не держались на `git push`. Жёсткий backstop
// состояния стоит на TS-точке записи версий (list-store), но на проде git идёт в
// Rust-ядро (SETFORK_CORE_URL), где понятий frozen/archived нет вовсе — push
// принимался и создавал новую версию замороженного списка. Воспроизведение живьём
// в реестре линзы; здесь закрепляем правило на РОУТЕ — единственной точке, общей
// для обоих режимов ядра.

const h = vi.hoisted(() => ({
  auth: null as null | { userId: string; scope: 'read' | 'write' },
  calls: { infoRefs: 0, receive: 0 },
}))

vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => h.auth }))
vi.mock('@/features/git/core', () => ({
  gitCore: {
    infoRefsReceivePack: async () => {
      h.calls.infoRefs++
      return Buffer.from('refs')
    },
    receivePack: async () => {
      h.calls.receive++
      // magic — форма ответа ядра с Ф4; двойник обязан её повторять, иначе он
      // проверяет не тот контракт, что в проде.
      return { data: Buffer.from('ok'), newVersion: null, magic: [] }
    },
  },
}))

const { db, users, templates, collaborators } = await import('@/shared/db')
const route = await import('@/app/[handle]/[slug]/[...git]/route')

const uid: Record<string, string> = {}
const OWNER = 'gw-owner'

const basic = () => ({ authorization: `Basic ${Buffer.from('git:token').toString('base64')}` })
const params = (slug: string, git: string[]) => ({ params: Promise.resolve({ handle: OWNER, slug, git }) })

const push = (slug: string) =>
  route.POST(new Request(`http://localhost/${OWNER}/${slug}.git/git-receive-pack`, { method: 'POST', headers: basic(), body: 'pack' }), params(slug, ['git-receive-pack']))

const advertise = (slug: string) =>
  route.GET(new Request(`http://localhost/${OWNER}/${slug}.git/info/refs?service=git-receive-pack`, { headers: basic() }), params(slug, ['info', 'refs']))

async function makeList(slug: string, over: Record<string, unknown> = {}): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: slug }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  return t.id
}

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  for (const k of ['owner', 'collab', 'stranger']) {
    const [u] = await db.insert(users).values({ handle: k === 'owner' ? OWNER : `gw-${k}` }).returning({ id: users.id })
    uid[k] = u.id
  }
  const frozen = await makeList('frozen-list', { frozenAt: new Date() })
  await db.insert(collaborators).values({ templateId: frozen, userId: uid.collab })
  await makeList('archived-list', { archivedAt: new Date() })
  await makeList('live-list')
}, 60_000)

beforeEach(() => {
  h.calls.infoRefs = 0
  h.calls.receive = 0
  h.auth = { userId: uid.owner, scope: 'write' }
})

describe('push в замороженный и архивный список', () => {
  it('владелец не пушит в замороженный: 403 и ядро не тронуто', async () => {
    const res = await push('frozen-list')
    expect(res.status).toBe(403)
    expect(h.calls.receive).toBe(0)
  })

  it('коллаборатор — тоже (именно этот путь обходил заморозку)', async () => {
    h.auth = { userId: uid.collab, scope: 'write' }
    expect((await push('frozen-list')).status).toBe(403)
    expect(h.calls.receive).toBe(0)
  })

  it('архив закрыт тем же правилом', async () => {
    expect((await push('archived-list')).status).toBe(403)
    expect(h.calls.receive).toBe(0)
  })

  it('отказ приходит уже на рекламе рефов — git не начинает передачу пака', async () => {
    expect((await advertise('frozen-list')).status).toBe(403)
    expect(h.calls.infoRefs).toBe(0)
  })

  it('обычный список пушится (контроль: гейт не запретил всё подряд)', async () => {
    expect((await push('live-list')).status).toBe(200)
    expect(h.calls.receive).toBe(1)
    expect((await advertise('live-list')).status).toBe(200)
  })

  it('чужой и read-only токен — 403: личность доказана, не хватает прав', async () => {
    // Было 401 на обоих случаях. 401 отправляет git к credential helper за новым
    // паролем, хотя пароль верный, а список человек видит — отказ не про личность
    // (карточка [...git]/012). «Не ваш ЗАКРЫТЫЙ список» — по-прежнему 404, чтобы
    // не выдать его существование: см. transport-access.itest.ts.
    h.auth = { userId: uid.stranger, scope: 'write' }
    expect((await push('live-list')).status).toBe(403)
    h.auth = { userId: uid.owner, scope: 'read' }
    expect((await push('live-list')).status).toBe(403)
    expect(h.calls.receive).toBe(0)
  })

  it('снятие заморозки возвращает запись', async () => {
    await db.update(templates).set({ frozenAt: null }).where(eq(templates.slug, 'frozen-list'))
    expect((await push('frozen-list')).status).toBe(200)
  })
})
