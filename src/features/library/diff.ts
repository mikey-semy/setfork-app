import type { StepLevel } from '@/shared/db'

// Дифф двух версий списка. Стабильных id у шагов между версиями нет,
// поэтому сопоставляем по заголовку (нормализованному). Эвристика, но наглядная.

export interface CmpStep {
  title: string
  desc: string
  command: string
  level: StepLevel
  why: string
  subtasks: string[]
}

export type DiffStatus = 'added' | 'removed' | 'changed' | 'moved' | 'unchanged'

export interface DiffEntry extends CmpStep {
  status: DiffStatus
  changes: string[] // какие поля изменились (для 'changed')
  before?: CmpStep // прежние значения (для 'changed')
}

const key = (s: CmpStep) => s.title.trim().toLowerCase()
const sameSubs = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function diffSteps(from: CmpStep[], to: CmpStep[]): {
  entries: DiffEntry[]
  summary: { added: number; removed: number; changed: number }
} {
  const fromMap = new Map<string, { s: CmpStep; i: number }>()
  from.forEach((s, i) => fromMap.set(key(s), { s, i }))
  const toKeys = new Set(to.map(key))

  const entries: DiffEntry[] = []
  let added = 0
  let changed = 0
  let removed = 0

  to.forEach((s, i) => {
    const f = fromMap.get(key(s))
    if (!f) {
      entries.push({ ...s, status: 'added', changes: [] })
      added++
      return
    }
    const changes: string[] = []
    if (f.s.desc !== s.desc) changes.push('desc')
    if (f.s.command !== s.command) changes.push('command')
    if (f.s.level !== s.level) changes.push('level')
    if (f.s.why !== s.why) changes.push('why')
    if (!sameSubs(f.s.subtasks, s.subtasks)) changes.push('subtasks')
    if (changes.length) {
      entries.push({ ...s, status: 'changed', changes, before: f.s })
      changed++
    } else if (f.i !== i) {
      entries.push({ ...s, status: 'moved', changes: [] })
    } else {
      entries.push({ ...s, status: 'unchanged', changes: [] })
    }
  })

  from.forEach((s) => {
    if (!toKeys.has(key(s))) {
      entries.push({ ...s, status: 'removed', changes: [] })
      removed++
    }
  })

  return { entries, summary: { added, removed, changed } }
}

// ── Построчный unified-дифф (как код-дифф GitHub) ────────────────────

/** Шаги версии → плоский список строк для построчного диффа. */
export function serializeSteps(steps: CmpStep[], ordered: boolean): string[] {
  const lines: string[] = []
  steps.forEach((s, idx) => {
    if (idx > 0) lines.push('')
    lines.push(`${ordered ? `${idx + 1}.` : '•'} ${s.title}${s.level !== 'required' ? `  [${s.level}]` : ''}`)
    if (s.desc) s.desc.split('\n').forEach((l) => lines.push(`    ${l}`))
    if (s.command) s.command.split('\n').forEach((l) => lines.push(`    $ ${l}`))
    if (s.why) lines.push(`    why: ${s.why}`)
    s.subtasks.forEach((st) => lines.push(`    - [ ] ${st}`))
  })
  return lines
}

export interface DiffRow {
  type: 'ctx' | 'add' | 'del'
  oldNo?: number
  newNo?: number
  text: string
}

/** LCS построчный дифф двух наборов строк → unified-строки. */
export function lineDiff(a: string[], b: string[]): { rows: DiffRow[]; added: number; removed: number } {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'ctx', oldNo: i + 1, newNo: j + 1, text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', oldNo: i + 1, text: a[i] })
      i++
      removed++
    } else {
      rows.push({ type: 'add', newNo: j + 1, text: b[j] })
      j++
      added++
    }
  }
  while (i < n) {
    rows.push({ type: 'del', oldNo: i + 1, text: a[i] })
    i++
    removed++
  }
  while (j < m) {
    rows.push({ type: 'add', newNo: j + 1, text: b[j] })
    j++
    added++
  }
  return { rows, added, removed }
}
