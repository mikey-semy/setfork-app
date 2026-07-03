import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { buildRepoFromVersions, loadListVersions } from './bundle'
import type { RepoFile } from './serialize'

const exec = promisify(execFile)

// Персистентные bare-репозитории — источник правды для git-объектов.
// Прод: смонтировать том и задать GIT_DATA_DIR.
const ROOT = process.env.GIT_DATA_DIR || join(process.cwd(), '.setfork-git')
const IDENT = ['-c', 'user.name=SetFork', '-c', 'user.email=git@setfork.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']

const repoPath = (templateId: string) => join(ROOT, `${templateId}.git`)

// Внутрипроцессная сериализация операций над одним репозиторием.
const locks = new Map<string, Promise<unknown>>()
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  locks.set(key, prev.then(() => gate))
  try {
    await prev
    return await fn()
  } finally {
    release()
    if (locks.get(key) === prev.then(() => gate)) locks.delete(key)
  }
}

const exists = (p: string) => access(p).then(() => true).catch(() => false)

async function resetTree(dir: string): Promise<void> {
  for (const entry of await readdir(dir)) {
    if (entry === '.git') continue
    await rm(join(dir, entry), { recursive: true, force: true })
  }
}
async function writeFiles(dir: string, files: RepoFile[]): Promise<void> {
  for (const f of files) {
    const full = join(dir, f.path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, f.content, 'utf8')
  }
}

const PRE_RECEIVE = `#!/bin/sh
# SetFork: каждый пушнутый коммит обязан содержать list.json в корне.
while read old new ref; do
  case "$new" in *0000000000000000000000000000000000000000) continue ;; esac
  if ! git cat-file -e "$new:list.json" 2>/dev/null; then
    echo "SetFork: list.json is required at the repo root" >&2
    exit 1
  fi
done
exit 0
`

async function installHook(bare: string): Promise<void> {
  const hook = join(bare, 'hooks', 'pre-receive')
  await mkdir(dirname(hook), { recursive: true })
  await writeFile(hook, PRE_RECEIVE, 'utf8')
  await chmod(hook, 0o755).catch(() => {})
}

async function resolveList(owner: string, slug: string): Promise<{ id: string; currentVersion: number } | null> {
  const [row] = await db
    .select({ id: templates.id, currentVersion: templates.currentVersion })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return row ?? null
}

async function maxTagVersion(bare: string): Promise<number> {
  try {
    const { stdout } = await exec('git', ['-C', bare, 'tag', '--list', 'v*'])
    let max = 0
    for (const t of stdout.split('\n')) {
      const m = /^v(\d+)$/.exec(t.trim())
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max
  } catch {
    return 0
  }
}

/** Дописывает недостающие версии (созданные в вебе) поверх текущего main — детерминированно,
 *  сохраняя ранее запушенные коммиты. */
async function appendVersions(bare: string, files: { version: number; note: string; createdAt: Date; files: RepoFile[] }[]): Promise<void> {
  if (files.length === 0) return
  const wt = await mkdtemp(join(tmpdir(), 'setfork-wt-'))
  try {
    await exec('git', ['-C', bare, 'worktree', 'add', '--quiet', '--detach', wt, 'main'])
    for (const v of files) {
      await resetTree(wt)
      await writeFiles(wt, v.files)
      const date = new Date(v.createdAt).toISOString()
      const message = v.note && !['initial', 'edit', 'seeded'].includes(v.note) ? `v${v.version}: ${v.note}` : `v${v.version}`
      await exec('git', [...IDENT, '-C', wt, 'add', '-A'])
      await exec('git', [...IDENT, '-C', wt, 'commit', '-q', '--allow-empty', '-m', message], {
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      })
      await exec('git', [...IDENT, '-C', wt, 'tag', '-f', `v${v.version}`]).catch(() => {})
    }
    const { stdout } = await exec('git', ['-C', wt, 'rev-parse', 'HEAD'])
    await exec('git', ['-C', bare, 'update-ref', 'refs/heads/main', stdout.trim()])
  } finally {
    await exec('git', ['-C', bare, 'worktree', 'remove', '--force', wt]).catch(() => {})
    await rm(wt, { recursive: true, force: true }).catch(() => {})
  }
}

/** Гарантирует персистентный bare-репозиторий, синхронный с историей версий.
 *  Возвращает путь или null. Источник правды: git-объекты (пуш сохраняется), а
 *  веб-версии дописываются лениво поверх. */
export async function ensureRepo(owner: string, slug: string): Promise<string | null> {
  const meta = await resolveList(owner, slug)
  if (!meta) return null
  const bare = repoPath(meta.id)

  return withLock(meta.id, async () => {
    if (!(await exists(bare))) {
      // bootstrap из полной истории
      const versions = await loadListVersions(owner, slug)
      if (!versions || versions.length === 0) return null
      const work = await buildRepoFromVersions(versions)
      if (!work) return null
      try {
        await mkdir(ROOT, { recursive: true })
        await exec('git', ['clone', '--bare', '--quiet', work, bare])
        await installHook(bare)
      } finally {
        await rm(work, { recursive: true, force: true }).catch(() => {})
      }
      return bare
    }

    // репо есть → дописать недостающие веб-версии (сохраняя запушенные коммиты)
    const have = await maxTagVersion(bare)
    if (meta.currentVersion > have) {
      const versions = await loadListVersions(owner, slug)
      if (versions) await appendVersions(bare, versions.filter((v) => v.version > have))
    }
    return bare
  })
}

/** Сериализация критической секции push (receive-pack + проекция) под тем же локом. */
export function withRepoLock<T>(templateId: string, fn: () => Promise<T>): Promise<T> {
  return withLock(templateId, fn)
}

/** Bundle из персистентного репо (включая запушенные коммиты). */
export async function bundleRepo(owner: string, slug: string): Promise<Buffer | null> {
  const bare = await ensureRepo(owner, slug)
  if (!bare) return null
  const out = join(tmpdir(), `setfork-${randomUUID()}.bundle`)
  try {
    await exec('git', ['-C', bare, 'bundle', 'create', out, '--all'])
    const { readFile } = await import('node:fs/promises')
    return await readFile(out)
  } catch {
    return null
  } finally {
    await rm(out, { force: true }).catch(() => {})
  }
}

export { repoPath }
