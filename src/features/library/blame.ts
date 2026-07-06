import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { db, steps as stepsTable, templateVersions, templates } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

// «Blame» по шагам: для каждого шага текущей версии — в какой версии он в
// последний раз менялся (по позиции n, как git blame по строкам). Автора у
// версий пока нет (см. план) — показываем версию, дату и note.

export interface StepBlame {
  n: number
  title: LocaleText
  section: LocaleText
  lastVersion: number // версия, где контент шага последний раз изменился
  lastAt: Date
  note: string
}
export interface ListBlame {
  currentVersion: number
  steps: StepBlame[]
}

// Канонический слепок контента шага для сравнения между версиями. jsonb в PG
// отдаёт ключи в стабильном порядке, поэтому JSON.stringify детерминирован.
function canon(s: { title: unknown; desc: unknown; command: string; level: string; why: unknown; section: unknown; subtasks: unknown; refs: unknown }): string {
  return JSON.stringify([s.title, s.desc, s.command, s.level, s.why, s.section, s.subtasks, s.refs])
}

export async function getListBlame(templateId: string): Promise<ListBlame | null> {
  const [tpl] = await db.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, templateId)).limit(1)
  if (!tpl) return null

  // Все шаги всех версий одним запросом (версии по возрастанию, шаги по n).
  const rows = await db
    .select({
      version: templateVersions.version,
      createdAt: templateVersions.createdAt,
      note: templateVersions.note,
      n: stepsTable.n,
      title: stepsTable.title,
      desc: stepsTable.desc,
      command: stepsTable.command,
      level: stepsTable.level,
      why: stepsTable.why,
      section: stepsTable.section,
      subtasks: stepsTable.subtasks,
      refs: stepsTable.refs,
    })
    .from(stepsTable)
    .innerJoin(templateVersions, eq(stepsTable.versionId, templateVersions.id))
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(asc(templateVersions.version), asc(stepsTable.n))

  // version → (n → canon), плюс метаданные версии.
  const byVersion = new Map<number, Map<number, string>>()
  const verMeta = new Map<number, { createdAt: Date; note: string }>()
  const currentSteps = new Map<number, { title: LocaleText; section: LocaleText }>()
  for (const r of rows) {
    if (!byVersion.has(r.version)) byVersion.set(r.version, new Map())
    byVersion.get(r.version)!.set(r.n, canon(r))
    if (!verMeta.has(r.version)) verMeta.set(r.version, { createdAt: r.createdAt, note: r.note })
    if (r.version === tpl.current) currentSteps.set(r.n, { title: r.title as LocaleText, section: r.section as LocaleText })
  }

  const versionsAsc = [...byVersion.keys()].sort((a, b) => a - b)
  const out: StepBlame[] = []
  for (const [n, disp] of [...currentSteps.entries()].sort((a, b) => a[0] - b[0])) {
    // Идём по версиям вверх до текущей: фиксируем версию, где canon шага n сменился.
    let prev: string | undefined
    let lastVersion = versionsAsc[0] ?? tpl.current
    for (const v of versionsAsc) {
      if (v > tpl.current) break
      const c = byVersion.get(v)!.get(n) // undefined = шага n в этой версии не было
      if (c !== prev) lastVersion = v
      prev = c
    }
    const meta = verMeta.get(lastVersion)!
    out.push({ n, title: disp.title, section: disp.section, lastVersion, lastAt: meta.createdAt, note: meta.note })
  }
  return { currentVersion: tpl.current, steps: out }
}
