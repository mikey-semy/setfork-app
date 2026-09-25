import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * АДРЕСА СКИЛЛА — `/{handle}/{slug}/SKILL.md` и `/{handle}/{slug}/skill.tar.gz`.
 *
 * Проверяется то, что не видно чистому сборщику: кто получает файл (приватный список
 * не утекает), что архив распаковывается в ожидаемую папку и что скрипт в нём тот же,
 * что отдаёт `/raw`, — сравнением ДВУХ НАСТОЯЩИХ ОТВЕТОВ, а не функции с самой собой.
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session, requireSession: async () => h.session }))
vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => null }))
// getLang читает куку, а вне запроса Next её нет: язык здесь не предмет проверки.
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))

const { db, users, templates, templateVersions, steps } = await import('@/shared/db')
const skillMd = await import('@/app/[handle]/[slug]/SKILL.md/route')
const skillTar = await import('@/app/[handle]/[slug]/skill.tar.gz/route')
const raw = await import('@/app/[handle]/[slug]/raw/route')

const OWNER = 'skill-owner'
const uid: Record<string, string> = {}

const params = (slug: string) => ({ params: Promise.resolve({ handle: OWNER, slug }) })
const req = (slug: string, tail: string) => new Request(`http://localhost/${OWNER}/${slug}/${tail}`)
const getMd = (slug: string) => skillMd.GET(req(slug, 'SKILL.md'), params(slug))
const getTar = (slug: string) => skillTar.GET(req(slug, 'skill.tar.gz'), params(slug))

async function makeList(slug: string, over: Record<string, unknown> = {}, blocks: Record<string, unknown>[] = [{ command: 'echo hi' }]) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: slug }, desc: { en: `About ${slug}` }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  let n = 0
  for (const b of blocks) await db.insert(steps).values({ versionId: v.id, n: ++n, title: { en: `Step ${n}` }, ...b })
}

/** Распаковать ответ системным tar и вернуть пути и корень. */
async function unpack(res: Response): Promise<{ dir: string; paths: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'skill-route-'))
  writeFileSync(join(dir, 'a.tgz'), Buffer.from(await res.arrayBuffer()))
  const out = join(dir, 'out')
  execFileSync('mkdir', ['-p', out])
  execFileSync('tar', ['-xzf', join(dir, 'a.tgz'), '-C', out])
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(out, join(d, f))]))
  return { dir: out, paths: walk(out).sort() }
}

beforeAll(async () => {
  process.env.APP_URL = 'https://canonical.test'
  // Своя изолированная песочница: тест повторно прогоняется на той же базе.
  await db.delete(users).where(eq(users.handle, OWNER))
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  uid.owner = u.id
  await makeList('runbook', {}, [
    { type: 'text', title: {}, content: { md: 'Background of the runbook.' } },
    { command: 'systemctl status nginx' },
    { command: 'journalctl -u nginx -n 50' },
  ])
  await makeList('prose', {}, [{ command: '' }])
  await makeList('priv', { visibility: 'private' })
  // Пометка «здесь нужен человек» — надстройка в строке шага (в канон git не пишется),
  // поэтому доехать до SKILL.md она может только через toExportList.
  await makeList('human-step', {}, [{ command: 'docker compose restart app', needsHuman: true, needsHumanAsk: { en: 'is it ok to restart now' } }])
  // Настоящая форма с прода: слаг обрезан до 60 знаков и кончается дефисом.
  await makeList('skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda-')
})

beforeEach(() => {
  h.session = null
})

describe('кто получает скилл', () => {
  it('публичный список — 200 анониму, markdown', async () => {
    const res = await getMd('runbook')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(await res.text()).toMatch(/^---\nname: "runbook"\n/)
  })

  it.each([['SKILL.md'], ['skill.tar.gz']])('приватный список анониму — 404 (%s)', async (tail) => {
    const res = tail === 'SKILL.md' ? await getMd('priv') : await getTar('priv')
    expect(res.status, 'приватный список утёк скиллом').toBe(404)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it.each([['SKILL.md'], ['skill.tar.gz']])('приватный список владельцу — 200 (%s)', async (tail) => {
    h.session = { userId: uid.owner, handle: OWNER }
    const res = tail === 'SKILL.md' ? await getMd('priv') : await getTar('priv')
    expect(res.status, 'владелец не может забрать свой же скилл').toBe(200)
  })

  it('несуществующий — 404', async () => {
    expect((await getMd('no-such-list')).status).toBe(404)
  })
})

describe('что агент получает в SKILL.md', () => {
  it('шаг «нужен человек» из базы доезжает до SKILL.md пометкой с вопросом автора', async () => {
    const md = await (await getMd('human-step')).text()
    expect(md, 'флаг из строки шага потерялся по дороге в экспорт').toContain('NEEDS A HUMAN — stop here and ask the human: is it ok to restart now')
    expect(md, 'шаг человека подан исполняемым блоком').not.toMatch(/```sh\n\s*docker compose restart/)
  })
})

describe('архив', () => {
  it('папка с именем скилла: SKILL.md и скрипт — и ничего больше (текст — в SKILL.md)', async () => {
    const res = await getTar('runbook')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/gzip')
    const { paths } = await unpack(res)
    expect(paths).toEqual(['runbook/SKILL.md', 'runbook/scripts/run.sh'])
  })

  it('слаг с дефисом на конце — папка и name без него, и они совпадают', async () => {
    const { dir, paths } = await unpack(await getTar('skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda-'))
    const name = 'skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda'
    expect(paths[0].split('/')[0], 'папка с дефисом на конце — стандарт её отвергнет').toBe(name)
    expect(readFileSync(join(dir, name, 'SKILL.md'), 'utf8')).toContain(`\nname: "${name}"\n`)
  })

  it('scripts/run.sh — байт в байт ответ /raw', async () => {
    const { dir } = await unpack(await getTar('runbook'))
    const script = readFileSync(join(dir, 'runbook/scripts/run.sh'), 'utf8')
    const rawRes = await raw.GET(req('runbook', 'raw'), params('runbook'))
    expect(rawRes.status).toBe(200)
    expect(script, 'скрипт в скилле разошёлся с /raw').toBe(await rawRes.text())
  })

  it('список без команд — scripts/ в архиве нет', async () => {
    const { paths } = await unpack(await getTar('prose'))
    expect(paths.some((p) => p.includes('/scripts/'))).toBe(false)
  })
})
