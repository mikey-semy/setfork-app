'use server'

import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import { requireViewableMeta } from './guard'
import { getVersionSteps } from './queries'
import { diffSteps, type CmpStep, type DiffStatus } from './diff'

export interface CommitDiffEntry {
  status: Exclude<DiffStatus, 'unchanged'>
  title: string
  level: CmpStep['level']
}
export interface CommitDiff {
  entries: CommitDiffEntry[]
  counts: { added: number; removed: number; changed: number; moved: number }
}

// Пункты версии (LocaleText) → CmpStep (строки на языке зрителя) — как на сравнении.
function stepsToCmp(
  steps: {
    title: LocaleText
    desc: LocaleText
    command: string
    level: CmpStep['level']
    why: LocaleText
    section?: LocaleText
    subtasks: LocaleText[]
    refs?: { label: LocaleText; url?: string }[]
  }[],
  lang: Lang,
): CmpStep[] {
  return steps.map((s) => ({
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    section: s.section ? tr(s.section, lang) : '',
    subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean),
    refs: (s.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url ?? '' })).filter((r) => r.label || r.url),
  }))
}

/**
 * Изменения ОДНОГО коммита (версии) против предыдущей — для аккордеона на странице
 * «Коммиты». Первая версия (нет предыдущей) → всё как «добавлено». Возвращает
 * компактные записи (статус + заголовок пункта) + счётчики. Гейт видимости — как у
 * страницы (requireViewableMeta).
 */
export async function getCommitDiff(owner: string, slug: string, version: number, lang: Lang): Promise<CommitDiff | null> {
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return null

  const [fromV, toV] = await Promise.all([
    version > 1 ? getVersionSteps(meta.id, version - 1) : Promise.resolve(null),
    getVersionSteps(meta.id, version),
  ])
  if (!toV) return null

  const { entries } = diffSteps(stepsToCmp(fromV?.steps ?? [], lang), stepsToCmp(toV.steps, lang))
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 }
  const out: CommitDiffEntry[] = []
  for (const e of entries) {
    if (e.status === 'unchanged') continue
    counts[e.status]++
    out.push({ status: e.status, title: e.title, level: e.level })
  }
  return { entries: out, counts }
}
