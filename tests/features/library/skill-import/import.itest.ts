import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../../helpers/reset-db'

/**
 * ИМПОРТ ЧУЖОГО СКИЛЛА — на настоящем ядре и базе. Подменён только GitHub (внешний край):
 * ответы API и raw собираются из описания репозитория ниже.
 *
 * Правило владельца (25.09.2026): видимость следует лицензии. Открытая — черновик может
 * стать публичным, источник указан; без лицензии — только приватный, и ни настройки, ни
 * копия «из шаблона» его публичным не делают.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

type Repo = { files: Record<string, { text: string; mode?: string }> }
const h = vi.hoisted(() => ({ repo: { files: {} } as Repo, session: null as null | { userId: string; handle: string } }))
const SHA = 'a'.repeat(40)

vi.mock('@/shared/lib/safe-fetch', () => ({
  fetchPublicUrl: async (url: string) => {
    const u = new URL(url)
    const ok = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
    if (u.host === 'api.github.com') {
      if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) return ok({ default_branch: 'main' })
      if (u.pathname.includes('/commits/')) return ok({ sha: SHA })
      if (u.pathname.includes('/git/trees/'))
        return ok({ truncated: false, tree: Object.entries(h.repo.files).map(([path, f]) => ({ path, mode: f.mode ?? '100644', type: 'blob', size: f.text.length })) })
    }
    if (u.host === 'raw.githubusercontent.com') {
      const path = decodeURIComponent(u.pathname.split('/').slice(4).join('/'))
      const f = h.repo.files[path]
      return f ? ok(f.text) : new Response('nf', { status: 404 })
    }
    return new Response('nf', { status: 404 })
  },
}))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { to })
  },
}))

const { db, templates, users, listDrafts } = await import('@/shared/db')
const { importSkillFromGithub } = await import('@/features/mcp/tools')
const { setListVisibility } = await import('@/features/library/actions/list-settings')
const { useTemplate } = await import('@/features/library/actions/forks')
const { gitCore } = await import('@/features/git/core')

const HANDLE = 'importer'
let userId = ''
const row = async (slug: string) => (await db.select().from(templates).where(eq(templates.slug, slug)))[0]
const skillMd = (name: string, license?: string) =>
  ['---', `name: ${name}`, 'description: Fill PDFs. Use when asked to fill a PDF.', ...(license ? [`license: ${license}`] : []), '---', `# ${name}`, '', '1. **Fill** it', ''].join('\n')

description('импорт скилла с GitHub', () => {
  beforeAll(async () => {
    await resetTables([listDrafts, templates, users])
    ;[{ id: userId }] = await db.insert(users).values({ handle: HANDLE }).returning({ id: users.id })
  })
  beforeEach(() => {
    h.session = { userId, handle: HANDLE }
  })

  it('открытая лицензия: публичный черновик, источник и лицензия записаны, исполняемость scripts/ сохранена', async () => {
    h.repo = {
      files: {
        'skills/pdf/SKILL.md': { text: skillMd('pdf', 'MIT') },
        'skills/pdf/scripts/fill.sh': { text: '#!/bin/sh\necho fill\n', mode: '100755' },
        'skills/pdf/references/forms.md': { text: '# Forms\n' },
        'skills/pdf/scripts/lib/deep.sh': { text: 'echo deep\n' },
        'skills/other/SKILL.md': { text: skillMd('other') },
      },
    }
    const res = await importSkillFromGithub(userId, 'github.com/ann/skills/tree/main/skills/pdf')
    if ('error' in res) throw new Error(res.error)
    expect(res).toMatchObject({ ref: `${HANDLE}/pdf`, privateOnly: false, license: { id: 'MIT', open: true } })
    expect(res.skipped).toEqual([{ path: 'scripts/lib/deep.sh', why: expect.stringContaining('subfolder') }])
    const r = await row('pdf')
    expect(r).toMatchObject({ visibility: 'public', status: 'draft', isSkill: true, sourceLicense: 'MIT', sourceLicenseOpen: true })
    expect(r.sourceUrl).toBe(`https://github.com/ann/skills/tree/${SHA}/skills/pdf`)
    const files = ((await gitCore.authoredFiles({ owner: HANDLE, slug: 'pdf' }, r.currentVersion)) ?? []).map((f) => [f.path, f.executable]).sort()
    expect(files).toEqual([
      ['references/forms.md', false],
      ['scripts/fill.sh', true],
    ])
  })

  it('в репозитории несколько скиллов, папка не названа — отказ со списком', async () => {
    const res = await importSkillFromGithub(userId, 'github.com/ann/skills')
    expect(res).toEqual({ error: expect.stringContaining('holds 2 skills') })
  })

  it('без лицензии: приватный навсегда — настройки и «из шаблона» публичным не делают', async () => {
    h.repo = { files: { 'SKILL.md': { text: skillMd('secret-sauce') } } }
    const res = await importSkillFromGithub(userId, 'https://github.com/corp/sauce')
    if ('error' in res) throw new Error(res.error)
    expect(res).toMatchObject({ privateOnly: true, license: { open: false } })
    const r = await row('secret-sauce')
    expect(r).toMatchObject({ visibility: 'private', sourceLicenseOpen: false })

    await setListVisibility(r.id, 'public').catch(() => {})
    expect((await row('secret-sauce')).visibility, 'настройки обошли запрет').toBe('private')

    await db.update(templates).set({ isTemplate: true, status: 'published' }).where(eq(templates.id, r.id))
    await useTemplate(r.id).catch((e) => {
      if (!(e as { to?: string }).to) throw e
    })
    const copy = await row('secret-sauce-copy')
    expect(copy, 'копия не создалась').toBeDefined()
    expect(copy).toMatchObject({ visibility: 'private', sourceLicenseOpen: false, sourceUrl: r.sourceUrl })
  })
})
