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
  files: [] as { path: string; content: Uint8Array; executable: boolean }[],
}))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session, requireSession: async () => h.session }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/git/core', () => ({ gitCore: { authoredFiles: async () => h.files } }))

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

describe('blob — файл автора текстом', () => {
  it('html автора уходит текстом, не страницей', async () => {
    const res = await get('badge-skill', 'assets/page.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(await res.text()).toBe('<script>alert(1)</script>')
  })

  it('нет такого файла или пути — 404', async () => {
    expect((await get('badge-skill', 'scripts/none.sh')).status).toBe(404)
    expect((await get('badge-skill', '')).status).toBe(404)
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
