// Каноническая сериализация версии списка в набор файлов git-дерева.
// Чистая функция (без server-only) — тестируется в node напрямую.

export type RepoFile = { path: string; content: string }

export type SerStep = {
  n: number
  // type/content — блочная модель. Для шага (дефолт) НЕ сериализуем эти поля,
  // чтобы старые списки давали БАЙТ-В-БАЙТ тот же list.json (golden с Rust).
  // Не-step блоки (text/image) несут type + content, .md-файл им не пишется.
  type?: string // 'step' (или undefined) | 'text' | 'image'
  content?: Record<string, unknown>
  title: string
  desc: string
  command: string
  level: string
  why: string
  section: string
  subtasks: string[]
  refs: { label: string; url?: string }[]
}

const isStepBlock = (s: SerStep): boolean => !s.type || s.type === 'step'

export type SerVersion = {
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  version: number
  steps: SerStep[]
}

function slugifyStep(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9а-я]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'step'
  )
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/** README.md — человекочитаемый обзор списка. */
function readme(v: SerVersion): string {
  const lines: string[] = []
  lines.push(`# ${v.title}`, '')
  if (v.desc) lines.push(v.desc, '')
  if (v.tags.length) lines.push(v.tags.map((t) => `\`${t}\``).join(' '), '')
  // Счётчик «items» и нумерация — только по шаг-блокам (презентационные не в счёт).
  const stepCount = v.steps.filter(isStepBlock).length
  lines.push(`> ${v.ordered ? 'Ordered list' : 'Unordered set'} · v${v.version} · ${stepCount} items`, '')

  let section = ''
  let stepNum = 0
  for (const s of v.steps) {
    if (!isStepBlock(s)) {
      // Презентационные блоки — inline в README.
      if (s.type === 'text') {
        const md = String(s.content?.md ?? '')
        if (md) lines.push('', md, '')
      } else if (s.type === 'image') {
        const ref = String(s.content?.ref ?? '')
        if (ref) lines.push('', `![${String(s.content?.caption ?? '')}](${ref})`, '')
      } else if (s.type === 'poll') {
        const q = String(s.content?.question ?? '')
        const opts = Array.isArray(s.content?.options) ? (s.content!.options as { text?: unknown }[]) : []
        if (q || opts.length) {
          lines.push('', `**📊 ${q}**`)
          opts.forEach((o) => lines.push(`- ${String(o?.text ?? '')}`))
          lines.push('')
        }
      } else if (s.type === 'video') {
        const url = String(s.content?.url ?? '')
        if (url) lines.push('', `🎬 [${String(s.content?.caption ?? '') || url}](${url})`, '')
      }
      continue
    }
    if (s.section && s.section !== section) {
      section = s.section
      lines.push('', `## ${section}`, '')
    }
    stepNum++
    const marker = v.ordered ? `${stepNum}.` : '-'
    const lvl = s.level && s.level !== 'required' ? ` _(${s.level})_` : ''
    lines.push(`${marker} **${s.title}**${lvl}`)
    if (s.desc) lines.push(`   ${s.desc.replace(/\n/g, '\n   ')}`)
    if (s.command) lines.push('', '   ```sh', `   ${s.command}`, '   ```')
    if (s.why) lines.push(`   > why: ${s.why}`)
    s.subtasks.forEach((st) => lines.push(`   - [ ] ${st}`))
    s.refs.forEach((r) => lines.push(`   - ${r.url ? `[${r.label}](${r.url})` : r.label}`))
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Один файл на шаг — стабильные пути для читаемых diff в git. */
function stepFile(s: SerStep, width: number): RepoFile {
  const front: string[] = ['---', `title: ${JSON.stringify(s.title)}`, `level: ${s.level}`]
  if (s.section) front.push(`section: ${JSON.stringify(s.section)}`)
  if (s.command) front.push(`command: ${JSON.stringify(s.command)}`)
  front.push('---', '')
  const body: string[] = []
  if (s.desc) body.push(s.desc, '')
  if (s.why) body.push(`**Why:** ${s.why}`, '')
  if (s.subtasks.length) body.push(...s.subtasks.map((st) => `- [ ] ${st}`), '')
  if (s.refs.length) body.push(...s.refs.map((r) => `- ${r.url ? `[${r.label}](${r.url})` : r.label}`), '')
  return {
    path: `steps/${pad(s.n, width)}-${slugifyStep(s.title)}.md`,
    content: front.join('\n') + body.join('\n').trimEnd() + '\n',
  }
}

/** Полный набор файлов версии (снимок рабочего дерева коммита). */
export function versionFiles(v: SerVersion): RepoFile[] {
  const width = Math.max(2, String(v.steps.length).length)
  const files: RepoFile[] = [{ path: 'README.md', content: readme(v) }]
  // list.json — машиночитаемый снимок (для инструментов/CI).
  files.push({
    path: 'list.json',
    content: JSON.stringify({ title: v.title, desc: v.desc, tags: v.tags, ordered: v.ordered, version: v.version, steps: v.steps }, null, 2) + '\n',
  })
  // .md пишем ТОЛЬКО шаг-блокам; text/image живут в README + list.json.
  for (const s of v.steps) if (isStepBlock(s)) files.push(stepFile(s, width))
  return files
}

/** Обратный разбор list.json → SerVersion (чистый, для diff/merge и импорта).
 *  Возвращает null на невалидном JSON/структуре. */
export function parseList(json: string): SerVersion | null {
  let o: unknown
  try {
    o = JSON.parse(json)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  if (!Array.isArray(r.steps)) return null
  const asStr = (x: unknown, d = '') => (typeof x === 'string' ? x : d)
  return {
    title: asStr(r.title),
    desc: asStr(r.desc),
    tags: Array.isArray(r.tags) ? r.tags.map((t) => asStr(t)) : [],
    ordered: !!r.ordered,
    version: typeof r.version === 'number' ? r.version : 0,
    steps: r.steps.map((raw, i) => {
      const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const type = typeof s.type === 'string' && s.type !== 'step' ? s.type : undefined
      const content = type && s.content && typeof s.content === 'object' ? (s.content as Record<string, unknown>) : undefined
      return {
        n: typeof s.n === 'number' ? s.n : i + 1,
        ...(type ? { type } : {}),
        ...(content ? { content } : {}),
        title: asStr(s.title),
        desc: asStr(s.desc),
        command: asStr(s.command),
        level: asStr(s.level, 'required'),
        why: asStr(s.why),
        section: asStr(s.section),
        subtasks: Array.isArray(s.subtasks) ? s.subtasks.map((x) => asStr(x)) : [],
        refs: Array.isArray(s.refs)
          ? s.refs.map((raw) => {
              const rr = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
              return { label: asStr(rr.label), ...(typeof rr.url === 'string' ? { url: rr.url } : {}) }
            })
          : [],
      }
    }),
  }
}
