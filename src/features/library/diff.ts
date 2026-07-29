import type { StepLevel } from '@/shared/db'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'

// Дифф двух версий списка построчно, но нумерация — по ПУНКТАМ (не «строки кода»):
// номер пункта показывается у его заголовка, продолжения (описание/команда/подпункты)
// идут без номера. Плюс пословная подсветка изменённых строк.

export interface CmpStep {
  // Блочная модель: 'step' (дефолт, undefined тоже = шаг) | 'text' | 'image' | 'poll' | 'video'.
  // content — payload презентационных блоков. Без него их текст в диффе НЕ ВИДЕН:
  // удалённый блок «Текст» показывался голым «1.» без единой строки содержимого.
  type?: string
  content?: Record<string, unknown>
  /** Стабильная идентичность блока сквозь версии (steps.block_id). */
  blockId?: string | null
  title: string
  desc: string
  command: string
  level: StepLevel
  why: string
  section?: string
  subtasks: string[]
  refs?: { label: string; url: string }[]
}

export const isStepBlock = (s: CmpStep): boolean => !s.type || s.type === 'step'

/** Маркер презентационного блока в «кодовом» виде (у шага вместо него номер). */
const BLOCK_MARK: Record<string, string> = { text: '¶', image: '🖼', poll: '📊', video: '🎬' }

const firstLine = (v: unknown): string => String(v ?? '').split('\n')[0].trim()

/**
 * Человекочитаемая подпись блока: у шага — заголовок, у презентационного — суть
 * его content. Нужна везде, где UI показывает «что это за пункт»: у таких блоков
 * title пустой, и без подписи карточка диффа выходила безымянной.
 */
export function blockLabel(s: CmpStep): string {
  if (isStepBlock(s)) return s.title
  const c = s.content ?? {}
  if (s.type === 'text') return firstLine(c.md)
  if (s.type === 'image') return firstLine(c.caption) || firstLine(c.ref)
  if (s.type === 'poll') return firstLine(c.question)
  if (s.type === 'video') return firstLine(c.caption) || firstLine(c.url)
  return s.title
}

/** Строки содержимого презентационного блока — тело для построчного диффа. */
function blockBody(s: CmpStep): string[] {
  const c = s.content ?? {}
  const str = (v: unknown) => String(v ?? '')
  if (s.type === 'text') return str(c.md).split('\n').slice(1)
  if (s.type === 'image') return [str(c.ref)].filter(Boolean)
  if (s.type === 'poll') {
    const opts = Array.isArray(c.options) ? (c.options as { text?: unknown }[]) : []
    return opts.map((o) => `- ${str(o?.text)}`)
  }
  if (s.type === 'video') return [str(c.url)].filter(Boolean)
  return []
}

/** Строка блока как она лежит в БД (locale-JSON поля). */
export type StepRow = {
  type?: string
  content?: Record<string, unknown>
  blockId?: string | null
  title: LocaleText
  desc: LocaleText
  command: string
  level: StepLevel
  why: LocaleText
  section?: LocaleText | null
  subtasks: LocaleText[]
  refs?: { label: LocaleText; url?: string }[] | null
}

/**
 * Блоки версии → CmpStep на языке зрителя. Единый конвертер для всех мест
 * сравнения (страница сравнения, коммиты, генерация release notes): раньше в
 * каждом лежала своя копия, и все три одинаково теряли type/content.
 */
export function rowsToCmp(rows: StepRow[], lang: Lang): CmpStep[] {
  return rows.map((s) => ({
    type: s.type,
    content: s.content,
    blockId: s.blockId ?? null,
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    section: s.section ? tr(s.section, lang) : '',
    subtasks: (s.subtasks ?? []).map((x) => tr(x, lang)).filter(Boolean),
    refs: (s.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url ?? '' })).filter((r) => r.label || r.url),
  }))
}

export interface SLine {
  text: string
  step: number // номер пункта, которому принадлежит строка
  head: boolean // строка-заголовок пункта (только у неё показываем номер)
}

/** Блоки версии → строки с привязкой к номеру пункта. */
export function serializeSteps(steps: CmpStep[], ordered: boolean): SLine[] {
  const lines: SLine[] = []
  let prevSection = ''
  // Нумерация — ТОЛЬКО по шаг-блокам, как в README и в самом списке. Раньше номер
  // брался из индекса массива, и презентационный блок «съедал» номер: пункты в
  // диффе были пронумерованы иначе, чем на странице списка.
  let stepNum = 0
  steps.forEach((s, idx) => {
    const step = idx + 1
    if (!isStepBlock(s)) {
      const mark = BLOCK_MARK[s.type ?? ''] ?? '¶'
      lines.push({ text: `${mark} ${blockLabel(s)}`.trimEnd(), step, head: true })
      blockBody(s).forEach((l) => lines.push({ text: `    ${l}`, step, head: false }))
      return
    }
    stepNum++
    const section = s.section?.trim() ?? ''
    if (section && section !== prevSection) lines.push({ text: `## ${section}`, step, head: false })
    prevSection = section
    lines.push({ text: `${ordered ? `${stepNum}.` : '•'} ${s.title}${s.level !== 'required' ? `  [${s.level}]` : ''}`, step, head: true })
    if (s.desc) s.desc.split('\n').forEach((l) => lines.push({ text: `    ${l}`, step, head: false }))
    if (s.command) s.command.split('\n').forEach((l) => lines.push({ text: `    $ ${l}`, step, head: false }))
    if (s.why) lines.push({ text: `    why: ${s.why}`, step, head: false })
    s.subtasks.forEach((st) => lines.push({ text: `    - [ ] ${st}`, step, head: false }))
    ;(s.refs ?? []).forEach((r) => {
      const label = r.label.trim()
      const url = r.url.trim()
      const text = url ? (label ? `${label} — ${url}` : url) : label
      if (text) lines.push({ text: `    → ${text}`, step, head: false })
    })
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

// Фолбэк-ключ сопоставления, когда стабильного blockId нет (данные старше него
// или запись мимо редактора): по типу + подписи. У него известные пороки —
// переименование читается как «удалён + добавлен», одинаковые подписи
// коллизируют. Тип в ключе, чтобы шаг и блок не матчились друг с другом.
const skey = (s: CmpStep) => `${isStepBlock(s) ? 'step' : s.type}:${blockLabel(s).trim().toLowerCase()}`
const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const refsKey = (rs?: { label: string; url: string }[]) => (rs ?? []).map((r) => `${r.label.trim()}|${r.url.trim()}`).join('\n')
const contentKey = (s: CmpStep) => JSON.stringify(s.content ?? {})

/**
 * Структурный дифф двух версий по БЛОКАМ.
 *
 * Сопоставление идёт по стабильному blockId (идентичность живёт сквозь версии),
 * и только при его отсутствии — по типу+подписи. Разница принципиальная:
 * с идентичностью переименование пункта — это «изменён», а не «удалён+добавлен»,
 * и два пункта с одинаковым заголовком больше не склеиваются в один.
 */
export function diffSteps(from: CmpStep[], to: CmpStep[]): {
  entries: DiffEntry[]
  summary: { added: number; removed: number; changed: number; moved: number }
} {
  const byId = new Map<string, number>()
  const byKey = new Map<string, number[]>()
  from.forEach((s, i) => {
    if (s.blockId) byId.set(s.blockId, i)
    const k = skey(s)
    byKey.set(k, [...(byKey.get(k) ?? []), i])
  })

  // Индексы from, уже отданные какому-то блоку из to: одна строка старой версии
  // не может быть источником для двух новых (иначе дубли подписей врут в счётчиках).
  const taken = new Set<number>()
  // Есть ли в СТАРОЙ версии пункты без идентичности. Это не редкость, а обычное
  // состояние всего, что записано до ADR-0013 и до переводов, терявших blockId.
  const fromHasIdless = from.some((s) => !s.blockId)
  /** Индекс блока в from + как он найден: по идентичности или по подписи. */
  const pick = (s: CmpStep): { i: number; byIdentity: boolean } | null => {
    if (s.blockId) {
      const i = byId.get(s.blockId)
      if (i != null && !taken.has(i)) return { i, byIdentity: true }
      // Блок с известной идентичностью, которой не было раньше, — точно новый:
      // по подписи не ищем, иначе «добавили пункт с тем же заголовком» слипнется.
      //
      // НО только когда у старой версии идентичности вообще были. Если там есть
      // пункты без blockId, короткий вывод неверен: первая же запись после появления
      // идентичностей выдавала бы «всё удалено и всё добавлено» — весь список читался
      // бы как переписанный заново.
      if (i == null && !fromHasIdless) return null
    }
    const queue = byKey.get(skey(s)) ?? []
    for (const i of queue) if (!taken.has(i)) return { i, byIdentity: false }
    return null
  }

  const entries: DiffEntry[] = []
  let added = 0
  let changed = 0
  let removed = 0
  let moved = 0
  to.forEach((s, i) => {
    const hit = pick(s)
    if (!hit) {
      entries.push({ ...s, status: 'added', changes: [] })
      added++
      return
    }
    const { i: fi, byIdentity } = hit
    taken.add(fi)
    const before = from[fi]
    const changes: string[] = []
    // Заголовок сравниваем ТОЛЬКО при матче по идентичности — так виден
    // «переименовали пункт». В фолбэк-режиме подпись сама является ключом
    // (и ключ регистронезависим), там сравнивать нечего.
    if (byIdentity && before.title !== s.title) changes.push('title')
    if (before.desc !== s.desc) changes.push('desc')
    if (before.command !== s.command) changes.push('command')
    if (before.level !== s.level) changes.push('level')
    if (before.why !== s.why) changes.push('why')
    if (!sameArr(before.subtasks, s.subtasks)) changes.push('subtasks')
    if (refsKey(before.refs) !== refsKey(s.refs)) changes.push('refs')
    if (contentKey(before) !== contentKey(s)) changes.push('content')
    if (changes.length) {
      entries.push({ ...s, status: 'changed', changes, before })
      changed++
    } else if (fi !== i) {
      entries.push({ ...s, status: 'moved', changes: [] })
      moved++
    } else entries.push({ ...s, status: 'unchanged', changes: [] })
  })
  from.forEach((s, i) => {
    if (!taken.has(i)) {
      entries.push({ ...s, status: 'removed', changes: [] })
      removed++
    }
  })
  return { entries, summary: { added, removed, changed, moved } }
}
