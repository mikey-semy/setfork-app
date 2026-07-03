import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db, steps as stepsTable, templates, templateVersions, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { versionFiles, type RepoFile, type SerStep } from './serialize'

const exec = promisify(execFile)

function pick(lt: unknown): string {
  const o = (lt ?? {}) as LocaleText
  return o.en ?? Object.values(o)[0] ?? ''
}

export type VersionData = { version: number; note: string; createdAt: Date; files: RepoFile[] }

/** Загружает список + все версии (asc) + шаги, сериализует каждую версию в файлы. */
async function loadVersions(templateId: string, ordered: boolean, title: LocaleText, desc: LocaleText, tags: string[]): Promise<VersionData[]> {
  const versions = await db
    .select({ id: templateVersions.id, version: templateVersions.version, note: templateVersions.note, createdAt: templateVersions.createdAt })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(asc(templateVersions.version))

  const out: VersionData[] = []
  for (const v of versions) {
    const rows = await db.select().from(stepsTable).where(eq(stepsTable.versionId, v.id)).orderBy(asc(stepsTable.n))
    const serSteps: SerStep[] = rows.map((s) => ({
      n: s.n,
      title: pick(s.title),
      desc: pick(s.desc),
      command: s.command ?? '',
      level: s.level,
      why: pick(s.why),
      section: pick(s.section),
      subtasks: (s.subtasks as LocaleText[]).map(pick).filter(Boolean),
      refs: (s.refs as { label: LocaleText; url?: string }[]).map((r) => ({ label: pick(r.label), url: r.url })),
    }))
    out.push({
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
      files: versionFiles({ title: pick(title), desc: pick(desc), tags, ordered, version: v.version, steps: serSteps }),
    })
  }
  return out
}

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

const GIT_BASE = ['-c', 'user.name=SetHub', '-c', 'user.email=git@sethub.dev', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']

/** Общая загрузка версий списка. Возвращает null если списка нет. */
export async function loadListVersions(ownerHandle: string, slug: string): Promise<VersionData[] | null> {
  const [tpl] = await db
    .select({ id: templates.id, title: templates.title, desc: templates.desc, tags: templates.tags, ordered: templates.ordered })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, ownerHandle), eq(templates.slug, slug)))
    .limit(1)
  if (!tpl) return null
  return loadVersions(tpl.id, tpl.ordered, tpl.title as LocaleText, tpl.desc as LocaleText, tpl.tags)
}

/** Материализует историю версий в git-репозиторий (temp dir). Детерминированные SHA
 *  (фикс. автор/даты) → одинаковы при каждой сборке, что нужно для stateless smart-HTTP.
 *  ВОЗВРАЩАЕТ путь; чистит вызывающий (rm -rf). null при ошибке/пустой истории. */
export async function buildRepoFromVersions(versions: VersionData[]): Promise<string | null> {
  if (!versions || versions.length === 0) return null
  const work = await mkdtemp(join(tmpdir(), 'sethub-git-'))
  try {
    await exec('git', ['init', '-q', '-b', 'main', work])
    for (const v of versions) {
      await resetTree(work)
      await writeFiles(work, v.files)
      const date = new Date(v.createdAt).toISOString()
      const message = v.note && !['initial', 'edit', 'seeded'].includes(v.note) ? `v${v.version}: ${v.note}` : `v${v.version}`
      await exec('git', [...GIT_BASE, '-C', work, 'add', '-A'])
      await exec('git', [...GIT_BASE, '-C', work, 'commit', '-q', '--allow-empty', '-m', message], {
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      })
      await exec('git', [...GIT_BASE, '-C', work, 'tag', `v${v.version}`]).catch(() => {}) // тег на версию (как релиз)
    }
    return work
  } catch {
    await rm(work, { recursive: true, force: true }).catch(() => {})
    return null
  }
}

/** Материализует репозиторий списка по owner/slug (для smart-HTTP). Вызывающий чистит dir. */
export async function materializeRepoForList(ownerHandle: string, slug: string): Promise<string | null> {
  const versions = await loadListVersions(ownerHandle, slug)
  if (!versions) return null
  return buildRepoFromVersions(versions)
}

/** Строит git-репозиторий из истории версий и возвращает bundle-файл (весь репо в одном файле).
 *  Клонируется стандартным `git clone <file>.bundle`. */
export async function buildListBundle(ownerHandle: string, slug: string): Promise<Buffer | null> {
  const versions = await loadListVersions(ownerHandle, slug)
  if (!versions) return null
  return bundleFromVersions(versions)
}

/** Материализует историю версий в git-репо и возвращает bundle-файл. Чистая (не трогает БД). */
export async function bundleFromVersions(versions: VersionData[]): Promise<Buffer | null> {
  const work = await buildRepoFromVersions(versions)
  if (!work) return null
  const bundlePath = join(tmpdir(), `sethub-${randomUUID()}.bundle`)
  try {
    await exec('git', [...GIT_BASE, '-C', work, 'bundle', 'create', bundlePath, '--all'])
    const { readFile } = await import('node:fs/promises')
    return await readFile(bundlePath)
  } catch {
    return null
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
    await rm(bundlePath, { force: true }).catch(() => {})
  }
}
