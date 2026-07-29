import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Линза 02, пункт 2 «чужие данные»: матрица зрителей × поверхностей.
// Дёргаем НАСТОЯЩИЕ обработчики роутов (не переписанную логику) с сессией каждой
// роли и смотрим, утёк ли маркер приватного/черновикового/снятого модерацией списка.
// Роли: аноним · посторонний · коллаборатор · владелец · админ.

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  getSession: async () => h.session,
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
  headers: async () => new Headers(),
}))

const { db, users, templates, templateVersions, steps, collaborators } = await import('@/shared/db')

const surfaces = {
  export: (await import('@/app/[handle]/[slug]/export/route')).GET,
  raw: (await import('@/app/[handle]/[slug]/raw/route')).GET,
  embed: (await import('@/app/[handle]/[slug]/embed/route')).GET,
  badge: (await import('@/app/[handle]/[slug]/badge/[kind]/route')).GET,
  atom: (await import('@/app/[handle]/[slug]/releases.atom/route')).GET,
  bundle: (await import('@/app/[handle]/[slug]/repo.bundle/route')).GET,
  git: (await import('@/app/[handle]/[slug]/[...git]/route')).GET,
} as const

const listsSearch = (await import('@/app/api/lists/search/route')).GET
const listTitle = (await import('@/app/api/list-title/route')).GET

const OWNER = 'lensowner'
const ids: Record<string, string> = {}
const uid: Record<string, string> = {}

const roles = {
  anon: () => null,
  stranger: () => ({ userId: uid.stranger, handle: 'lensstranger' }),
  collab: () => ({ userId: uid.collab, handle: 'lenscollab' }),
  owner: () => ({ userId: uid.owner, handle: OWNER }),
  admin: () => ({ userId: uid.admin, handle: 'lensadmin' }),
} as const
type Role = keyof typeof roles

async function makeList(slug: string, over: Record<string, unknown>, marker: string): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({
      ownerId: uid.owner,
      slug,
      title: { en: `Title-${marker}`, ru: `Заголовок-${marker}` },
      desc: { en: `Desc-${marker}`, ru: `Описание-${marker}` },
      tags: [`tag-${marker}`],
      currentVersion: 1,
      ...over,
    })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: `note-${marker}`, authorId: uid.owner })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: `Step-${marker}`, ru: `Шаг-${marker}` }, desc: {} })
  return t.id
}

/** Ответ обработчика при данной роли: код + утёк ли маркер в тело. */
async function hit(
  surface: keyof typeof surfaces,
  role: Role,
  slug: string,
  marker: string,
): Promise<{ status: number; leaked: boolean }> {
  h.session = roles[role]()
  const url =
    surface === 'git'
      ? `http://localhost/${OWNER}/${slug}.git/info/refs?service=git-upload-pack`
      : `http://localhost/${OWNER}/${slug}`
  const req = new Request(url)
  const params = Promise.resolve(
    surface === 'badge'
      ? { handle: OWNER, slug, kind: 'stars' }
      : surface === 'git'
        ? { handle: OWNER, slug: `${slug}.git`, git: ['info', 'refs'] }
        : { handle: OWNER, slug },
  )
  let res: Response
  try {
    res = (await (surfaces[surface] as (r: Request, c: { params: unknown }) => Promise<Response>)(req, { params })) as Response
  } catch (e) {
    // redirect()/notFound() из next/navigation бросают — это отказ, не утечка.
    return { status: (e as { digest?: string }).digest?.includes('NEXT_REDIRECT') ? 307 : 500, leaked: false }
  }
  const body = await res.text().catch(() => '')
  return { status: res.status, leaked: body.includes(marker) }
}

beforeAll(async () => {
  process.env.ADMIN_HANDLES = 'lensadmin'
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  for (const [k, handle] of [
    ['owner', OWNER],
    ['stranger', 'lensstranger'],
    ['collab', 'lenscollab'],
    ['admin', 'lensadmin'],
  ] as const) {
    const [u] = await db.insert(users).values({ handle, name: handle }).returning({ id: users.id })
    uid[k] = u.id
  }
  ids.pub = await makeList('pub-list', {}, 'PUBCANARY')
  ids.priv = await makeList('priv-list', { visibility: 'private' }, 'PRIVATECANARY')
  ids.draft = await makeList('draft-list', { status: 'draft' }, 'DRAFTCANARY')
  ids.flagged = await makeList('flagged-list', { moderation: 'flagged' }, 'FLAGGEDCANARY')
  for (const id of [ids.priv, ids.draft]) await db.insert(collaborators).values({ templateId: id, userId: uid.collab })
}, 60_000)

const READ_SURFACES = ['export', 'raw', 'embed', 'badge', 'atom', 'bundle', 'git'] as const

describe('приватный список: не должен утекать никому, кроме владельца и коллаборатора', () => {
  for (const s of READ_SURFACES) {
    it(`${s} — аноним и посторонний не получают маркер`, async () => {
      const anon = await hit(s, 'anon', 'priv-list', 'PRIVATECANARY')
      const stranger = await hit(s, 'stranger', 'priv-list', 'PRIVATECANARY')
      expect({ surface: s, anon: anon.leaked, stranger: stranger.leaked }).toEqual({ surface: s, anon: false, stranger: false })
    })
  }
})

describe('черновик и снятый модерацией: анонимные ассеты обязаны молчать', () => {
  for (const s of READ_SURFACES) {
    it(`${s} — черновик не утекает анониму`, async () => {
      expect((await hit(s, 'anon', 'draft-list', 'DRAFTCANARY')).leaked).toBe(false)
    })
    it(`${s} — снятый модерацией не утекает анониму`, async () => {
      expect((await hit(s, 'anon', 'flagged-list', 'FLAGGEDCANARY')).leaked).toBe(false)
    })
  }
})

describe('публичный список остаётся доступен (контроль, что проверка не «всё запретить»)', () => {
  for (const s of READ_SURFACES) {
    it(`${s} — аноним получает публичный`, async () => {
      const r = await hit(s, 'anon', 'pub-list', 'PUBCANARY')
      expect({ surface: s, status: r.status }).toEqual({ surface: s, status: 200 })
    })
  }
})

describe('поисковые API не отдают непубличное', () => {
  it('/api/lists/search не показывает приватный/черновик/снятый даже владельцу-анониму', async () => {
    h.session = null
    const res = await listsSearch(new Request('http://localhost/api/lists/search?q=Title'))
    const text = await res.text()
    expect({
      priv: text.includes('priv-list'),
      draft: text.includes('draft-list'),
      flagged: text.includes('flagged-list'),
      pub: text.includes('pub-list'),
    }).toEqual({ priv: false, draft: false, flagged: false, pub: true })
  })

  it('/api/list-title не раскрывает заголовок приватного списка постороннему', async () => {
    h.session = roles.stranger()
    const res = await listTitle(new Request(`http://localhost/api/list-title?h=${OWNER}&s=priv-list`) as never)
    const text = await res.text()
    expect(text.includes('PRIVATECANARY')).toBe(false)
  })
})
