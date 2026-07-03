import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { db, steps as stepsTable, templates, templateVersions } from '@/shared/db'
import type { StepLevel } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

const exec = promisify(execFile)

const LEVELS: StepLevel[] = ['required', 'recommended', 'optional']
const lvl = (v: unknown): StepLevel => (LEVELS.includes(v as StepLevel) ? (v as StepLevel) : 'required')
const L = (s?: string): LocaleText => (s && s.trim() ? { en: s.trim() } : {})

type ParsedStep = {
  title?: string
  desc?: string
  command?: string
  level?: string
  why?: string
  section?: string
  subtasks?: string[]
  refs?: { label?: string; url?: string }[]
}
type ParsedList = { title?: string; desc?: string; tags?: string[]; ordered?: boolean; steps?: ParsedStep[] }

/** Проецирует запушенный коммит (main tip bare-репо) в новую версию списка.
 *  Источник контента — list.json в корне дерева. Возвращает номер версии или null. */
export async function projectPushedCommit(templateId: string, bare: string): Promise<number | null> {
  const tip = (await exec('git', ['-C', bare, 'rev-parse', 'main'])).stdout.trim()
  let parsed: ParsedList
  try {
    const raw = (await exec('git', ['-C', bare, 'show', `${tip}:list.json`], { maxBuffer: 8 * 1024 * 1024 })).stdout
    parsed = JSON.parse(raw)
  } catch {
    return null // нет/битый list.json — pre-receive hook такое отклоняет, но подстрахуемся
  }
  if (!parsed || !Array.isArray(parsed.steps)) return null

  const subject = (await exec('git', ['-C', bare, 'log', '-1', '--format=%s', tip])).stdout.trim()
  const note = subject.replace(/^v\d+:\s*/, '').slice(0, 200) || 'pushed via git'

  const [tpl] = await db.select({ currentVersion: templates.currentVersion }).from(templates).where(eq(templates.id, templateId)).limit(1)
  if (!tpl) return null
  const newVersion = tpl.currentVersion + 1

  const [ver] = await db.insert(templateVersions).values({ templateId, version: newVersion, note }).returning()
  const rows = parsed.steps
    .filter((s) => (s.title ?? '').trim())
    .map((s, i) => ({
      versionId: ver.id,
      n: i + 1,
      title: L(s.title),
      desc: L(s.desc),
      command: (s.command ?? '').trim(),
      hasImage: false,
      imageKey: null,
      level: lvl(s.level),
      why: L(s.why),
      section: L(s.section),
      subtasks: (s.subtasks ?? []).filter((x) => x && x.trim()).map((x) => L(x)),
      refs: (s.refs ?? [])
        .filter((r) => r && (r.label ?? '').trim())
        .map((r) => ({ label: L(r.label), url: r.url?.trim() || undefined })),
    }))
  if (rows.length) await db.insert(stepsTable).values(rows)

  const patch: Partial<typeof templates.$inferInsert> = { currentVersion: newVersion, updatedAt: new Date() }
  if (typeof parsed.title === 'string' && parsed.title.trim()) patch.title = { en: parsed.title.trim() }
  if (typeof parsed.desc === 'string') patch.desc = parsed.desc.trim() ? { en: parsed.desc.trim() } : {}
  if (Array.isArray(parsed.tags)) patch.tags = parsed.tags.filter((t) => typeof t === 'string').slice(0, 20)
  if (typeof parsed.ordered === 'boolean') patch.ordered = parsed.ordered
  await db.update(templates).set(patch).where(eq(templates.id, templateId))

  await exec('git', ['-C', bare, 'tag', '-f', `v${newVersion}`, tip]).catch(() => {})
  return newVersion
}
