import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ДВОИЧНЫЕ ФАЙЛЫ СКИЛЛА — байты в хранилище по sha256, в дереве указатель Git LFS.
 *
 * Настоящие база и ядро; хранилище — дисковое (в итестах S3 нет, путь тот же, что у
 * разработки). Проверяется то, что ломается молча:
 *  • в дереве лежит УКАЗАТЕЛЬ, а наружу (архив, файл по адресу) уходят НАСТОЯЩИЕ байты;
 *  • та же картинка, присланная снова, — не изменение (иначе каждая публикация плодила бы
 *    версию «без изменений»);
 *  • двоичное вне assets/ и программы — отказ без записи;
 *  • указатель на байты, которых у нас нет, фасад записи не пропускает ни с какого пути.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

process.env.SKILL_ASSETS_DIR = mkdtempSync(join(tmpdir(), 'skill-assets-'))
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session, requireSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))

const { db, templates, users, listDrafts } = await import('@/shared/db')
const { mcpPublishSkill } = await import('@/features/mcp/tools/lists/skill')
const { gitCore } = await import('@/features/git/core')
const { coreCapabilities } = await import('@/shared/core-capabilities')
const { lfsPointerOf, lfsPointerText } = await import('@/core/domain/lfs-pointer')
const { listStore } = await import('@/features/library/list-store')
const skillTar = await import('@/app/[handle]/[slug]/skill.tar.gz/route')
const blob = await import('@/app/[handle]/[slug]/blob/route')

const HANDLE = 'asset-author'
// «PNG» с нулевыми байтами — двоичный по признаку git.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const LOGO = { path: 'assets/logo.png', content: b64(PNG), encoding: 'base64' as const }
const params = (slug: string) => ({ params: Promise.resolve({ handle: HANDLE, slug }) })

description('двоичные файлы скилла', () => {
  let accepts = false
  let tplId = ''
  beforeAll(async () => {
    await resetTables([listDrafts, templates, users])
    const [u] = await db.insert(users).values({ handle: HANDLE }).returning({ id: users.id })
    h.session = { userId: u.id, handle: HANDLE }
    accepts = (await coreCapabilities())?.acceptsAuthoredFiles === true
  })

  it('в дереве — указатель с размером и хешем, а не байты', async () => {
    if (!accepts) return
    const res = await mcpPublishSkill(h.session!.userId, { title: 'Brand kit', items: [{ title: 'Use the logo' }], files: [LOGO, { path: 'references/guide.md', content: '# Guide\n' }] })
    expect(res).toMatchObject({ version: 1 })
    const files = (await gitCore.authoredFiles({ owner: HANDLE, slug: 'brand-kit' }, 1)) ?? []
    const logo = files.find((f) => f.path === 'assets/logo.png')!
    expect(lfsPointerOf(logo.content)).toMatchObject({ size: PNG.length })
    const [row] = await db.select({ id: templates.id }).from(templates)
    tplId = row.id
  })

  it('архив скилла несёт НАСТОЯЩИЕ байты картинки', async () => {
    if (!accepts) return
    const res = await skillTar.GET(new Request(`http://localhost/${HANDLE}/brand-kit/skill.tar.gz`), params('brand-kit'))
    expect(res.status).toBe(200)
    const dir = mkdtempSync(join(tmpdir(), 'asset-tar-'))
    writeFileSync(join(dir, 'a.tgz'), Buffer.from(await res.arrayBuffer()))
    execFileSync('tar', ['-xzf', join(dir, 'a.tgz'), '-C', dir])
    expect(new Uint8Array(readFileSync(join(dir, 'brand-kit', 'assets', 'logo.png')))).toEqual(PNG)
  })

  it('файл по адресу — байты, скачиванием и как octet-stream', async () => {
    if (!accepts) return
    const res = await blob.GET(new Request(`http://localhost/${HANDLE}/brand-kit/blob?path=assets/logo.png`), params('brand-kit'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('та же картинка снова — не изменение: версии «без изменений» нет', async () => {
    if (!accepts) return
    const res = await mcpPublishSkill(h.session!.userId, { list: `${HANDLE}/brand-kit`, baseVersion: 1, files: [LOGO] })
    expect(res).toMatchObject({ version: 1, note: expect.stringMatching(/Nothing to change/) })
    const [row] = await db.select({ v: templates.currentVersion }).from(templates)
    expect(row.v).toBe(1)
  })

  it.each([
    ['двоичное вне assets/', { path: 'scripts/tool.bin', content: b64(PNG), encoding: 'base64' as const }, /binary files go to assets\//],
    ['программа Windows', { path: 'assets/setup.exe', content: b64(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0])), encoding: 'base64' as const }, /native program \(pe\)/],
  ])('%s — отказ без записи', async (_n, file, msg) => {
    if (!accepts) return
    const res = await mcpPublishSkill(h.session!.userId, { list: `${HANDLE}/brand-kit`, baseVersion: 1, files: [file] })
    expect((res as { error?: string }).error).toMatch(msg)
    const [row] = await db.select({ v: templates.currentVersion }).from(templates)
    expect(row.v).toBe(1)
  })

  it('указатель на байты, которых у нас нет, фасад записи не пропускает', async () => {
    if (!accepts) return
    const ghost = { path: 'assets/ghost.png', content: new TextEncoder().encode(lfsPointerText({ oid: 'd'.repeat(64), size: 9 })), executable: false }
    await expect(
      listStore.addVersion(tplId, { note: 'ghost', steps: [{ n: 1, title: { en: 'x' } }] as never, authored: [ghost], expectedVersion: 1 }),
    ).rejects.toMatchObject({ name: 'AuthoredFilesError', detail: expect.stringContaining('not in storage') })
  })
})
