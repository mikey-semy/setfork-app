import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * `publish_skill`: БЛОКИ И ФАЙЛЫ АВТОРА — ОДНОЙ ВЕРСИЕЙ, НА НАСТОЯЩЕМ ЯДРЕ.
 *
 * Ради чего инструмент: раньше текст и файлы ехали разными версиями, и промежуточную
 * успевали поставить. Проверяется то, что ломается молча:
 *
 *  • ядро, которое файлов НЕ понимает (окно выкатки), обязано дать отказ, а не принять
 *    версию и потерять набор: незнакомое поле proto3 теряется без следа. Тест смотрит на
 *    ответ ядра о возможности и проверяет ту ветку, которая сейчас правда: либо файлы
 *    легли и читаются из дерева, либо честный отказ и НИЧЕГО не записано;
 *  • ранние отказы (путь, двоичный файл, повтор, опасное в scripts/) — до ядра и без записи;
 *  • у нового списка «без файлов» ядру ничего не шлётся — старое ядро не мешает.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const { db, templates, users } = await import('@/shared/db')
const { mcpPublishSkill } = await import('@/features/mcp/tools/lists/skill')
const { gitCore } = await import('@/features/git/core')
const { createClient } = await import('@connectrpc/connect')
const { coreTransport } = await import('@/shared/core-transport')
const { GitCore } = await import('@/shared/gen/git_pb')

const HANDLE = 'skill-author'
let ownerId = ''

const coreAccepts = async () =>
  (await createClient(GitCore, coreTransport()).getCapabilities({}).catch(() => null))?.acceptsAuthoredFiles === true

const row = async (slug: string) => {
  const [r] = await db.select({ id: templates.id, version: templates.currentVersion }).from(templates).where(eq(templates.slug, slug))
  return r
}

const RUN = { path: 'scripts/run.sh', content: '#!/bin/sh\necho hello\n', executable: true }
const GUIDE = { path: 'references/guide.md', content: '# Guide\n' }

description('publish_skill', () => {
  beforeAll(async () => {
    await resetTables([templates, users])
    const [u] = await db.insert(users).values({ handle: HANDLE }).returning({ id: users.id })
    ownerId = u.id
  })

  it('новый скилл без файлов — обычный черновик, ядру набор не шлётся', async () => {
    const res = await mcpPublishSkill(ownerId, { title: 'Plain skill', items: [{ title: 'Do it' }], files: [] })
    expect(res).toMatchObject({ ref: `${HANDLE}/plain-skill`, version: 1, files: [] })
  })

  it('новый скилл с файлами: либо файлы в версии 1, либо честный отказ без записи', async () => {
    const res = await mcpPublishSkill(ownerId, { title: 'Filed skill', items: [{ title: 'Run it', command: 'sh scripts/run.sh' }], files: [RUN, GUIDE] })
    if (await coreAccepts()) {
      expect(res).toMatchObject({ version: 1, files: ['scripts/run.sh', 'references/guide.md'] })
      const files = await gitCore.authoredFiles({ owner: HANDLE, slug: 'filed-skill' }, 1)
      expect(files?.map((f) => [f.path, f.executable]).sort()).toEqual([
        ['references/guide.md', false],
        ['scripts/run.sh', true],
      ])
    } else {
      expect(res).toEqual({ error: expect.stringContaining('cannot take author files') })
      expect(await row('filed-skill')).toBeUndefined()
    }
  })

  it('существующий: без items меняются только файлы — одной версией; [] убирает', async () => {
    await mcpPublishSkill(ownerId, { title: 'Growing skill', items: [{ title: 'Step one' }], files: [] })
    const before = await row('growing-skill')
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: before.version, files: [GUIDE] })
    if (await coreAccepts()) {
      expect(res).toMatchObject({ version: before.version + 1, files: ['references/guide.md'] })
      const files = await gitCore.authoredFiles({ owner: HANDLE, slug: 'growing-skill' }, before.version + 1)
      expect(files?.map((f) => f.path)).toEqual(['references/guide.md'])
      const cleared = await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: before.version + 1, files: [] })
      expect(cleared).toMatchObject({ version: before.version + 2, files: [] })
      expect(await gitCore.authoredFiles({ owner: HANDLE, slug: 'growing-skill' }, before.version + 2)).toEqual([])
    } else {
      expect(res).toEqual({ error: expect.stringContaining('cannot take author files') })
      expect((await row('growing-skill')).version).toBe(before.version)
    }
  })

  it('устаревшая база — отказ до записи', async () => {
    const r = await row('growing-skill')
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: r.version + 1, files: [] })
    expect(res).toEqual({ error: expect.stringContaining('list changed') })
  })

  it.each([
    [{ path: 'scripts/sub/x.sh', content: 'x' }, 'bad file path'],
    [{ path: 'secrets/key.txt', content: 'x' }, 'bad file path'],
    [{ path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0, 1]).toString('base64'), encoding: 'base64' as const }, 'binary'],
  ])('ранний отказ: %j', async (file, words) => {
    const res = await mcpPublishSkill(ownerId, { title: `Refused ${words}`, items: [{ title: 'x' }], files: [file] })
    expect(res).toEqual({ error: expect.stringContaining(words) })
  })

  it('файл дважды — отказ', async () => {
    const res = await mcpPublishSkill(ownerId, { title: 'Twice', items: [{ title: 'x' }], files: [GUIDE, GUIDE] })
    expect(res).toEqual({ error: expect.stringContaining('listed twice') })
  })

  it('опасное в scripts/ — отказ, называющий файл, и списка нет', async () => {
    const res = await mcpPublishSkill(ownerId, {
      title: 'Dangerous skill',
      items: [{ title: 'Clean' }],
      files: [{ path: 'scripts/clean.sh', content: '#!/bin/sh\nrm -rf /\n' }],
    })
    expect(res).toEqual({ error: expect.stringContaining('scripts/clean.sh has a destructive command') })
    expect(await row('dangerous-skill')).toBeUndefined()
  })
})
