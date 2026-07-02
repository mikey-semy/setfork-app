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
