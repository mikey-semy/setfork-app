import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * `publish_skill`: БЛОКИ И ФАЙЛЫ АВТОРА — ОДНОЙ ВЕРСИЕЙ, НА НАСТОЯЩЕМ ЯДРЕ.
 *
 * Ради чего инструмент: раньше текст и файлы ехали разными версиями, и промежуточную
 * успевали поставить. Проверяется то, что ломается молча:
 *
 *  • ФАЙЛЫ ДОПОЛНЕНИЕМ: названные добавляются или заменяются, прочие остаются, режим
 *    сохраняется; удаляет только `removeFiles`, замена целиком — только `replaceFiles`.
 *    Первая редакция заменяла набор целиком, и «добавь скрипт» стирал файлы, которых агент
 *    не видел (линза 06, P1);
 *  • ядро, которое файлов НЕ понимает (окно выкатки), обязано дать отказ, а не принять
 *    версию и потерять набор. Тест спрашивает у ядра возможность и проверяет ту ветку,
 *    что сейчас правда: либо файлы легли и читаются из дерева, либо честный отказ и
 *    НИЧЕГО не записано;
 *  • ранние отказы (путь, имя, режим, двоичное, повтор, опасное в scripts/) — без записи;
 *  • мета существующего списка меняется, а не выбрасывается молча;
 *  • накопленная рабочая копия — отказ, а не версия поверх неё.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const { db, templates, users, listDrafts } = await import('@/shared/db')
const { mcpPublishSkill } = await import('@/features/mcp/tools/lists/skill')
const { mcpGetList } = await import('@/features/mcp/tools/reads')
const { gitCore } = await import('@/features/git/core')
const { coreCapabilities } = await import('@/shared/core-capabilities')

const HANDLE = 'skill-author'
let ownerId = ''

const coreAccepts = async () => (await coreCapabilities())?.acceptsAuthoredFiles === true

const row = async (slug: string) => {
  const [r] = await db
    .select({ id: templates.id, version: templates.currentVersion, desc: templates.desc })
    .from(templates)
    .where(eq(templates.slug, slug))
  return r
}
const filesAt = async (slug: string, version: number) =>
  ((await gitCore.authoredFiles({ owner: HANDLE, slug }, version)) ?? []).map((f) => [f.path, f.executable] as const).sort()

const RUN = { path: 'scripts/run.sh', content: '#!/bin/sh\necho hello\n', executable: true }
const GUIDE = { path: 'references/guide.md', content: '# Guide\n' }
const REFUSED_BY_CORE = 'does not accept author files'

description('publish_skill', () => {
  beforeAll(async () => {
    await resetTables([templates, users])
    const [u] = await db.insert(users).values({ handle: HANDLE }).returning({ id: users.id })
    ownerId = u.id
  })

  it('новый скилл без файлов — обычный черновик, ядру набор не шлётся', async () => {
    const res = await mcpPublishSkill(ownerId, { title: 'Plain skill', items: [{ title: 'Do it' }] })
    expect(res).toMatchObject({ ref: `${HANDLE}/plain-skill`, version: 1, status: 'draft' })
  })

  it('новый скилл с файлами: либо файлы в версии 1, либо честный отказ без записи', async () => {
    const res = await mcpPublishSkill(ownerId, { title: 'Filed skill', items: [{ title: 'Run it', command: 'sh scripts/run.sh' }], files: [RUN, GUIDE] })
    if (await coreAccepts()) {
      expect(res).toMatchObject({ version: 1, files: { added: ['scripts/run.sh', 'references/guide.md'] } })
      expect(await filesAt('filed-skill', 1)).toEqual([
        ['references/guide.md', false],
        ['scripts/run.sh', true],
      ])
      // get_list показывает набор — агенту есть с чего начинать правку.
      const read = (await mcpGetList(ownerId, HANDLE, 'filed-skill')) as { files?: { path: string; executable?: boolean }[] }
      expect(read.files?.map((f) => [f.path, f.executable === true]).sort()).toEqual([
        ['references/guide.md', false],
        ['scripts/run.sh', true],
      ])
    } else {
      expect(res).toEqual({ error: expect.stringContaining(REFUSED_BY_CORE) })
      expect(await row('filed-skill')).toBeUndefined()
    }
  })

  it('существующий: файлы ДОПОЛНЯЮТСЯ, режим сохраняется, удаляет только removeFiles', async () => {
    await mcpPublishSkill(ownerId, { title: 'Growing skill', items: [{ title: 'Step one' }] })
    const v1 = (await row('growing-skill')).version
    const first = await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: v1, files: [RUN] })
    if (!(await coreAccepts())) {
      expect(first).toEqual({ error: expect.stringContaining(REFUSED_BY_CORE) })
      expect((await row('growing-skill')).version).toBe(v1)
      return
    }
    expect(first).toMatchObject({ version: v1 + 1, files: { added: ['scripts/run.sh'], removed: [] } })

    // Второй файл без упоминания первого: первый остаётся, и остаётся исполняемым.
    const second = await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: v1 + 1, files: [GUIDE] })
    expect(second).toMatchObject({ files: { added: ['references/guide.md'], removed: [], total: 2 } })
    expect(await filesAt('growing-skill', v1 + 2)).toEqual([
      ['references/guide.md', false],
      ['scripts/run.sh', true],
    ])

    // Новый текст скрипта без executable — режим прежний.
    const edited = await mcpPublishSkill(ownerId, {
      list: `${HANDLE}/growing-skill`,
      baseVersion: v1 + 2,
      files: [{ path: 'scripts/run.sh', content: '#!/bin/sh\necho bye\n' }],
    })
    expect(edited).toMatchObject({ files: { changed: ['scripts/run.sh'] } })
    expect(await filesAt('growing-skill', v1 + 3)).toContainEqual(['scripts/run.sh', true])

    // Удаление — только названное.
    const removed = await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: v1 + 3, removeFiles: ['references/guide.md'] })
    expect(removed).toMatchObject({ files: { removed: ['references/guide.md'], total: 1 } })
    expect(await filesAt('growing-skill', v1 + 4)).toEqual([['scripts/run.sh', true]])

    // Замена целиком пустым набором — убрать всё.
    await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: v1 + 4, files: [], replaceFiles: true })
    expect(await filesAt('growing-skill', v1 + 5)).toEqual([])

    // Удалить несуществующее — отказ, а не молчаливый «успех».
    expect(await mcpPublishSkill(ownerId, { list: `${HANDLE}/growing-skill`, baseVersion: v1 + 5, removeFiles: ['scripts/nope.sh'] })).toEqual({
      error: expect.stringContaining('no such files'),
    })
  })

  it('ничего не меняется — версии нет', async () => {
    await mcpPublishSkill(ownerId, { title: 'Still skill', items: [{ title: 'x' }] })
    const r = await row('still-skill')
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/still-skill`, baseVersion: r.version })
    expect(res).toMatchObject({ version: r.version, note: expect.stringContaining('no version was made') })
    expect((await row('still-skill')).version).toBe(r.version)
  })

  it('описание существующего меняется, а не выбрасывается молча', async () => {
    await mcpPublishSkill(ownerId, { title: 'Described skill', desc: 'Old words', items: [{ title: 'x' }], lang: 'en' })
    const r = await row('described-skill')
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/described-skill`, baseVersion: r.version, desc: 'Does X. Use when Y.', lang: 'en' })
    expect(res).toMatchObject({ version: r.version + 1 })
    expect((await row('described-skill')).desc).toMatchObject({ en: 'Does X. Use when Y.' })
  })

  it('накопленная рабочая копия — отказ, версии нет', async () => {
    await mcpPublishSkill(ownerId, { title: 'Pending skill', items: [{ title: 'x' }] })
    const r = await row('pending-skill')
    await db.insert(listDrafts).values({ templateId: r.id, authorId: ownerId, baseVersion: r.version, items: [] })
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/pending-skill`, baseVersion: r.version, desc: 'new' })
    expect(res).toEqual({ error: expect.stringContaining('pending edits') })
    expect((await row('pending-skill')).version).toBe(r.version)
  })

  it('устаревшая база — отказ до записи', async () => {
    const r = await row('still-skill')
    const res = await mcpPublishSkill(ownerId, { list: `${HANDLE}/still-skill`, baseVersion: r.version + 1, desc: 'x' })
    expect(res).toEqual({ error: expect.stringContaining('list changed') })
  })

  it.each([
    [{ path: 'scripts/sub/x.sh', content: 'x' }, 'bad file path'],
    [{ path: 'secrets/key.txt', content: 'x' }, 'bad file path'],
    [{ path: 'scripts/.git', content: 'x' }, 'must not start with a dot'],
    [{ path: 'scripts/run‮hs.sh', content: 'x' }, 'text-direction'],
    [{ path: `references/${'я'.repeat(49)}.md`, content: 'x' }, 'too long'],
    [{ path: 'assets/setup.sh', content: 'rm -rf ~', executable: true }, 'cannot be executable'],
    [{ path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0, 1]).toString('base64'), encoding: 'base64' as const }, 'binary'],
    [{ path: 'references/a.md', content: 'plain text, not base64!', encoding: 'base64' as const }, 'not valid base64'],
  ])('ранний отказ: %j', async (file, words) => {
    const res = await mcpPublishSkill(ownerId, { title: `Refused ${words}`, items: [{ title: 'x' }], files: [file] })
    expect(res).toEqual({ error: expect.stringContaining(words) })
  })

  it('SKILL.md целиком: шаги и текст из тела, название и описание из шапки, непринятое названо', async () => {
    const md = [
      '---',
      'name: pdf-tools',
      'description: Fill and merge PDFs. Use when the user asks to work with a PDF.',
      'license: MIT',
      '---',
      '# PDF tools',
      '',
      'Works through pypdf.',
      '',
      '1. **Install** it once',
      '',
      '   ```bash',
      '   pip install pypdf',
      '   ```',
    ].join('\n')
    const res = await mcpPublishSkill(ownerId, { skillMd: md })
    expect(res).toMatchObject({ ref: `${HANDLE}/pdf-tools`, parseNotes: [expect.stringContaining('license')] })
    const read = (await mcpGetList(ownerId, HANDLE, 'pdf-tools')) as { title: string; desc: string; steps: { type?: string; title?: string; command?: string; text?: string }[] }
    expect(read.title).toBe('PDF tools')
    expect(read.desc).toBe('Fill and merge PDFs. Use when the user asks to work with a PDF.')
    expect(read.steps.map((b) => b.title ?? b.text)).toEqual(['Works through pypdf.', 'Install'])
    expect(read.steps[1]).toMatchObject({ command: 'pip install pypdf' })
    expect(await mcpPublishSkill(ownerId, { skillMd: md, items: [{ title: 'x' }] })).toEqual({ error: expect.stringContaining('either skillMd or items') })
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
