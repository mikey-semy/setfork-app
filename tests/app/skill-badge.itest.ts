import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * СКИЛЛ ВИДЕН В ОБЩЕМ ПОТОКЕ, А ЕГО ФАЙЛЫ — НА СТРАНИЦЕ, НА НАСТОЯЩЕЙ БАЗЕ.
 *
 *  • `blob` отдаёт файл автора ТОЛЬКО текстом (`text/plain` + `nosniff` + `sandbox`):
 *    файл пишет автор, и `assets/x.html`, отданный как html, исполнился бы на нашем
 *    домене. Видимость — как у страницы: приватный чужому — 404;
 *  • `is:skill` / `is:template` отбирают по метке, которую ставит автор;
 *  • метку меняет только владелец: чужому — `false`, и переключатель откатится.
 * Подменены только сессия и ядро git (его файлы — внешнее для этого теста).
 */
const h = vi.hoisted(() => ({
  session: null as null | { userId: string; handle: string },
  files: [] as { path: string; content: Uint8Array; executable: boolean }[] | null,
}))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session, requireSession: async () => h.session }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/git/core', () => ({
  gitCore: {
    authoredFiles: async () => {
      if (h.files === null) throw new Error('core is down')
      return h.files
    },
  },
}))

const { db, users, templates } = await import('@/shared/db')
const blob = await import('@/app/[handle]/[slug]/blob/route')
const { countLists } = await import('@/features/library/queries')
const { setListSkill } = await import('@/features/library/actions/forks')

const OWNER = 'badge-owner'
let ownerId = ''
let strangerId = ''

const get = (slug: string, path: string) =>
  blob.GET(new Request(`http://localhost/${OWNER}/${slug}/blob?path=${encodeURIComponent(path)}`), {
    params: Promise.resolve({ handle: OWNER, slug }),
  })

beforeAll(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  await db.delete(users).where(eq(users.handle, 'badge-stranger'))
  const [u] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [s] = await db.insert(users).values({ handle: 'badge-stranger' }).returning({ id: users.id })
  ownerId = u.id
  strangerId = s.id
  await db.insert(templates).values([
    { ownerId, slug: 'badge-skill', title: { en: 'unique-badge-skill' }, status: 'published', visibility: 'public', isSkill: true },
    { ownerId, slug: 'badge-tpl', title: { en: 'unique-badge-tpl' }, status: 'published', visibility: 'public', isTemplate: true },
    { ownerId, slug: 'badge-plain', title: { en: 'unique-badge-plain' }, status: 'published', visibility: 'public' },
    { ownerId, slug: 'badge-private', title: { en: 'unique-badge-private' }, status: 'published', visibility: 'private', isSkill: true },
  ])
})

beforeEach(() => {
  h.session = null
  h.files = [{ path: 'assets/page.html', content: new TextEncoder().encode('<script>alert(1)</script>'), executable: false }]
})

const getLines = (slug: string, path: string) =>
  blob.GET(new Request(`http://localhost/${OWNER}/${slug}/blob?path=${encodeURIComponent(path)}&format=lines`), {
    params: Promise.resolve({ handle: OWNER, slug }),
  })

describe('blob?format=lines — просмотр на странице', () => {
  it('строки уже подсвечены на сервере, язык — по расширению', async () => {
    h.files = [{ path: 'scripts/run.py', content: new TextEncoder().encode('def f():\n    return 1'), executable: true }]
    const res = await getLines('badge-skill', 'scripts/run.py')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { code: string; language: string; lines: { text: string; cls: string }[][] }
    expect(body.language).toBe('python')
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0].some((t) => t.cls.includes('hljs-keyword') && t.text === 'def')).toBe(true)
  })

  it('html автора — токенами-текстом в JSON, не разметкой', async () => {
    const res = await getLines('badge-skill', 'assets/page.html')
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('<script>alert(1)</script>')
  })

  it('видимость та же: приватный скилл чужому — 404', async () => {
    h.session = { userId: strangerId, handle: 'badge-stranger' }
    expect((await getLines('badge-private', 'assets/page.html')).status).toBe(404)
  })
})

describe('blob — файл автора текстом', () => {
  it('html автора уходит текстом, не страницей', async () => {
    const res = await get('badge-skill', 'assets/page.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(await res.text()).toBe('<script>alert(1)</script>')
  })

  it('отказы — Problem Details, и у каждого свой машинный код', async () => {
    const none = await get('badge-skill', 'scripts/none.sh')
    expect(none.status).toBe(404)
    expect(none.headers.get('content-type')).toContain('application/problem+json')
    expect((await none.json()).error).toBe('file_not_found')
    const noPath = await get('badge-skill', '')
    expect(noPath.status).toBe(400)
    expect((await noPath.json()).error).toBe('path_required')
    expect((await (await get('no-such-list', 'x')).json()).error).toBe('not_found')
  })

  it('ядро не ответило — 503 «повторите», а не «файла нет»', async () => {
    const saved = h.files
    h.files = null
    try {
      const res = await get('badge-skill', 'assets/page.html')
      expect(res.status).toBe(503)
      expect((await res.json()).error).toBe('core_unavailable')
    } finally {
      h.files = saved
    }
  })

  it('приватный список чужому — 404, владельцу — файл', async () => {
    h.session = { userId: strangerId, handle: 'badge-stranger' }
    expect((await get('badge-private', 'assets/page.html')).status).toBe(404)
    h.session = { userId: ownerId, handle: OWNER }
    expect((await get('badge-private', 'assets/page.html')).status).toBe(200)
  })
})

describe('is:skill / is:template', () => {
  it('отбирают по метке автора', async () => {
    expect(await countLists({ q: 'unique-badge', isSkill: true })).toBe(1) // приватный чужому не виден
    expect(await countLists({ q: 'unique-badge', isTemplate: true })).toBe(1)
    expect(await countLists({ q: 'unique-badge' })).toBe(3)
  })
})

describe('метку ставит только владелец', () => {
  it('чужому — false, метка не меняется; владельцу — true', async () => {
    const [plain] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, 'badge-plain'))
    h.session = { userId: strangerId, handle: 'badge-stranger' }
    expect(await setListSkill(plain.id, true)).toBe(false)
    h.session = { userId: ownerId, handle: OWNER }
    expect(await setListSkill(plain.id, true)).toBe(true)
    const [row] = await db.select({ isSkill: templates.isSkill }).from(templates).where(eq(templates.id, plain.id))
    expect(row.isSkill).toBe(true)
  })
})
