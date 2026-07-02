import type { StepLevel } from '@/shared/db'

// Дифф двух версий списка построчно, но нумерация — по ПУНКТАМ (не «строки кода»):
// номер пункта показывается у его заголовка, продолжения (описание/команда/подпункты)
// идут без номера. Плюс пословная подсветка изменённых строк.

export interface CmpStep {
  title: string
  desc: string
  command: string
  level: StepLevel
  why: string
  section?: string
  subtasks: string[]
}

export interface SLine {
  text: string
  step: number // номер пункта, которому принадлежит строка
  head: boolean // строка-заголовок пункта (только у неё показываем номер)
}

/** Шаги версии → строки с привязкой к номеру пункта. */
export function serializeSteps(steps: CmpStep[], ordered: boolean): SLine[] {
  const lines: SLine[] = []
  let prevSection = ''
  steps.forEach((s, idx) => {
    const step = idx + 1
    const section = s.section?.trim() ?? ''
    if (section && section !== prevSection) lines.push({ text: `## ${section}`, step, head: false })
    prevSection = section
    lines.push({ text: `${ordered ? `${step}.` : '•'} ${s.title}${s.level !== 'required' ? `  [${s.level}]` : ''}`, step, head: true })
    if (s.desc) s.desc.split('\n').forEach((l) => lines.push({ text: `    ${l}`, step, head: false }))
    if (s.command) s.command.split('\n').forEach((l) => lines.push({ text: `    $ ${l}`, step, head: false }))
    if (s.why) lines.push({ text: `    why: ${s.why}`, step, head: false })
    s.subtasks.forEach((st) => lines.push({ text: `    - [ ] ${st}`, step, head: false }))
  })
  return lines
}

export interface Seg {
  text: string
  changed: boolean
}
export interface DiffRow {
  type: 'ctx' | 'add' | 'del'
  oldNo?: number // номер строки в старой версии
  newNo?: number // номер строки в новой версии
  head: boolean
  text: string
  segs?: Seg[] // пословная подсветка (для изменённых пар строк)
}

const tokenize = (s: string): string[] => s.match(/\s+|\S+/g) ?? []

/** Пословный дифф двух строк → сегменты с флагом changed (для old и new). */
function wordDiff(oldStr: string, newStr: string): { old: Seg[]; neu: Seg[] } {
  const a = tokenize(oldStr)
  const b = tokenize(newStr)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const old: Seg[] = []
  const neu: Seg[] = []
  let i = 0
  let j = 0
  const pushOld = (text: string, changed: boolean) => {
    const last = old[old.length - 1]
    if (last && last.changed === changed) last.text += text
    else old.push({ text, changed })
  }
  const pushNeu = (text: string, changed: boolean) => {
    const last = neu[neu.length - 1]
    if (last && last.changed === changed) last.text += text
    else neu.push({ text, changed })
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushOld(a[i], false)
      pushNeu(b[j], false)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushOld(a[i], true)
      i++
    } else {
      pushNeu(b[j], true)
      j++
    }
  }
  while (i < n) pushOld(a[i++], true)
  while (j < m) pushNeu(b[j++], true)
  return { old, neu }
}

/** Проставляет пословную подсветку парам del→add (изменённая строка). */
function highlightPairs(rows: DiffRow[]): void {
  let i = 0
  while (i < rows.length) {
    if (rows[i].type === 'del') {
      let d = i
      while (d < rows.length && rows[d].type === 'del') d++
      let a = d
      while (a < rows.length && rows[a].type === 'add') a++
      const dels = d - i
      const adds = a - d
      const pairs = Math.min(dels, adds)
      for (let k = 0; k < pairs; k++) {
        const delRow = rows[i + k]
        const addRow = rows[d + k]
        const { old, neu } = wordDiff(delRow.text, addRow.text)
        delRow.segs = old
        addRow.segs = neu
      }
      i = a
    } else {
      i++
    }
  }
}

/** LCS построчный дифф с сохранением номеров пунктов + пословной подсветкой. */
export function lineDiff(a: SLine[], b: SLine[]): { rows: DiffRow[]; added: number; removed: number } {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      rows.push({ type: 'ctx', oldNo: i + 1, newNo: j + 1, head: a[i].head || b[j].head, text: a[i].text })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', oldNo: i + 1, head: a[i].head, text: a[i].text })
      i++
      removed++
    } else {
      rows.push({ type: 'add', newNo: j + 1, head: b[j].head, text: b[j].text })
      j++
      added++
    }
  }
  while (i < n) {
    rows.push({ type: 'del', oldNo: i + 1, head: a[i].head, text: a[i].text })
    i++
    removed++
  }
  while (j < m) {
    rows.push({ type: 'add', newNo: j + 1, head: b[j].head, text: b[j].text })
    j++
    added++
  }
  highlightPairs(rows)
  return { rows, added, removed }
}

// ── Структурный дифф по пунктам (для «списочного» вида) ──────────────
export type DiffStatus = 'added' | 'removed' | 'changed' | 'moved' | 'unchanged'
export interface DiffEntry extends CmpStep {
  status: DiffStatus
  changes: string[]
  before?: CmpStep
}

const skey = (s: CmpStep) => s.title.trim().toLowerCase()
const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function diffSteps(from: CmpStep[], to: CmpStep[]): {
  entries: DiffEntry[]
  summary: { added: number; removed: number; changed: number }
} {
  const fromMap = new Map<string, { s: CmpStep; i: number }>()
  from.forEach((s, i) => fromMap.set(skey(s), { s, i }))
  const toKeys = new Set(to.map(skey))
  const entries: DiffEntry[] = []
  let added = 0
  let changed = 0
  let removed = 0
  to.forEach((s, i) => {
    const f = fromMap.get(skey(s))
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
    if (!sameArr(f.s.subtasks, s.subtasks)) changes.push('subtasks')
    if (changes.length) {
      entries.push({ ...s, status: 'changed', changes, before: f.s })
      changed++
    } else if (f.i !== i) entries.push({ ...s, status: 'moved', changes: [] })
    else entries.push({ ...s, status: 'unchanged', changes: [] })
  })
  from.forEach((s) => {
    if (!toKeys.has(skey(s))) {
      entries.push({ ...s, status: 'removed', changes: [] })
      removed++
    }
  })
  return { entries, summary: { added, removed, changed } }
}
