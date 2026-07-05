import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import type { StepLevel } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { listStore } from '@/features/library/list-store'

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

  const [exists] = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, templateId)).limit(1)
  if (!exists) return null

  // Версия+шаги — через доменный порт ListStore (write-seam под Rust).
  const ver = await listStore.addVersion(templateId, {
    note,
    steps: parsed.steps
      .filter((s) => (s.title ?? '').trim())
      .map((s, i) => ({
        n: i + 1,
        title: L(s.title),
        desc: L(s.desc),
        command: (s.command ?? '').trim(),
        level: lvl(s.level),
        why: L(s.why),
        section: L(s.section),
        subtasks: (s.subtasks ?? []).filter((x) => x && x.trim()).map((x) => L(x)),
        refs: (s.refs ?? [])
          .filter((r) => r && (r.label ?? '').trim())
          .map((r) => ({ label: L(r.label), url: r.url?.trim() || undefined })),
        imageRef: null,
      })),
  })

  // Метаданные списка (title/desc/tags/ordered) — из list.json, отдельно от версии.
  const patch: Partial<typeof templates.$inferInsert> = {}
  if (typeof parsed.title === 'string' && parsed.title.trim()) patch.title = { en: parsed.title.trim() }
  if (typeof parsed.desc === 'string') patch.desc = parsed.desc.trim() ? { en: parsed.desc.trim() } : {}
  if (Array.isArray(parsed.tags)) patch.tags = parsed.tags.filter((t) => typeof t === 'string').slice(0, 20)
  if (typeof parsed.ordered === 'boolean') patch.ordered = parsed.ordered
  if (Object.keys(patch).length) await db.update(templates).set(patch).where(eq(templates.id, templateId))

  await exec('git', ['-C', bare, 'tag', '-f', `v${ver.version}`, tip]).catch(() => {})
  return ver.version
}
