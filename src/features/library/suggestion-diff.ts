import { tr, type LocaleText } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'

// Пошаговый diff правки против базовой версии (аналог «Files changed» в PR).
// Матчинг — LCS по ключу идентичности: стабильный blockId, если он есть, иначе
// нормализованный заголовок. С идентичностью переименование пункта в правке
// показывается как ИЗМЕНЕНИЕ (mod), а не как «удалён + добавлен» двумя строками.

type Lang = Parameters<typeof tr>[1]

export type DiffStep = {
  /** Стабильная идентичность блока сквозь версии (ProposedItem/steps.block_id). */
  blockId?: string
  title: LocaleText
  desc: LocaleText
  command: string
  level: StepLevel
  why: LocaleText
  section: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

export type FieldChange = { field: string; before: string; after: string }

export type DiffRow =
  | { kind: 'same'; step: DiffStep }
  | { kind: 'add'; step: DiffStep }
  | { kind: 'del'; step: DiffStep }
  | { kind: 'mod'; step: DiffStep; changes: FieldChange[] }

export type DiffSummary = { added: number; removed: number; modified: number; unchanged: number }

// StepRow (БД) или ProposedItem → общая форма для diff.
export function toDiffStep(s: Record<string, unknown>): DiffStep {
  return {
    blockId: typeof s.blockId === 'string' && s.blockId ? s.blockId : undefined,
    title: (s.title ?? {}) as LocaleText,
    desc: (s.desc ?? {}) as LocaleText,
    command: (s.command as string) ?? '',
    level: (s.level ?? 'required') as StepLevel,
    why: (s.why ?? {}) as LocaleText,
    section: (s.section ?? {}) as LocaleText,
    subtasks: (s.subtasks ?? []) as LocaleText[],
    refs: (s.refs ?? []) as { label: LocaleText; url?: string }[],
  }
}

function fieldChanges(a: DiffStep, b: DiffStep, lang: Lang): FieldChange[] {
  const out: FieldChange[] = []
  const T = (x: LocaleText) => tr(x, lang).trim()
  const push = (field: string, before: string, after: string) => {
    if (before !== after) out.push({ field, before, after })
  }
  const subs = (arr: LocaleText[]) => arr.map((x) => T(x)).filter(Boolean).join(' · ')
  const refs = (arr: { label: LocaleText; url?: string }[]) =>
    arr.map((r) => T(r.label) + (r.url ? ` (${r.url})` : '')).filter(Boolean).join(' · ')
  push('title', T(a.title), T(b.title))
  push('desc', T(a.desc), T(b.desc))
  push('command', a.command.trim(), b.command.trim())
  push('level', a.level, b.level)
  push('why', T(a.why), T(b.why))
  push('section', T(a.section), T(b.section))
  push('subtasks', subs(a.subtasks), subs(b.subtasks))
  push('refs', refs(a.refs), refs(b.refs))
  return out
}

/** Diff базовой версии → предложения. Порядок строк сохраняет позиции (LCS-выравнивание). */
export function diffSteps(
  baseRaw: Array<Record<string, unknown>>,
  proposedRaw: Array<Record<string, unknown>>,
  lang: Lang,
): { rows: DiffRow[]; summary: DiffSummary } {
  const base = baseRaw.map(toDiffStep)
  const prop = proposedRaw.map(toDiffStep)
  // Идентичность сильнее заголовка: у пункта с blockId ключ не меняется при
  // переименовании, поэтому LCS видит его как ту же строку.
  const key = (s: DiffStep) => (s.blockId ? `id#${s.blockId}` : tr(s.title, lang).trim().toLowerCase())
  const bk = base.map(key)
  const pk = prop.map(key)
  const n = base.length
  const m = prop.length

  // LCS DP (длина общей подпоследовательности по ключам-заголовкам)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = bk[i] === pk[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  const summary: DiffSummary = { added: 0, removed: 0, modified: 0, unchanged: 0 }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (bk[i] === pk[j]) {
      const changes = fieldChanges(base[i], prop[j], lang)
      if (changes.length) {
        rows.push({ kind: 'mod', step: prop[j], changes })
        summary.modified++
      } else {
        rows.push({ kind: 'same', step: prop[j] })
        summary.unchanged++
      }
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', step: base[i] })
      summary.removed++
      i++
    } else {
      rows.push({ kind: 'add', step: prop[j] })
      summary.added++
      j++
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', step: base[i] })
    summary.removed++
    i++
  }
  while (j < m) {
    rows.push({ kind: 'add', step: prop[j] })
    summary.added++
    j++
  }
  return { rows, summary }
}
