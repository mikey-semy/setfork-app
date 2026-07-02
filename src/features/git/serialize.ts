// Каноническая сериализация версии списка в набор файлов git-дерева.
// Чистая функция (без server-only) — тестируется в node напрямую.

export type RepoFile = { path: string; content: string }

export type SerStep = {
  n: number
  title: string
  desc: string
  command: string
  level: string
  why: string
  section: string
  subtasks: string[]
  refs: { label: string; url?: string }[]
}

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
  lines.push(`> ${v.ordered ? 'Ordered list' : 'Unordered set'} · v${v.version} · ${v.steps.length} items`, '')

  let section = ''
  v.steps.forEach((s, i) => {
    if (s.section && s.section !== section) {
      section = s.section
      lines.push('', `## ${section}`, '')
    }
    const marker = v.ordered ? `${i + 1}.` : '-'
    const lvl = s.level && s.level !== 'required' ? ` _(${s.level})_` : ''
    lines.push(`${marker} **${s.title}**${lvl}`)
    if (s.desc) lines.push(`   ${s.desc.replace(/\n/g, '\n   ')}`)
    if (s.command) lines.push('', '   ```sh', `   ${s.command}`, '   ```')
    if (s.why) lines.push(`   > why: ${s.why}`)
    s.subtasks.forEach((st) => lines.push(`   - [ ] ${st}`))
    s.refs.forEach((r) => lines.push(`   - ${r.url ? `[${r.label}](${r.url})` : r.label}`))
    lines.push('')
  })
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
  for (const s of v.steps) files.push(stepFile(s, width))
  return files
}
