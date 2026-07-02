// Экспорт списка в Markdown / автономный HTML (для скачивания и печати).
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'

export interface ExportStep {
  n: number
  title: LocaleText
  desc: LocaleText
  command: string
  level: StepLevel
  why: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}
export interface ExportList {
  title: LocaleText
  desc: LocaleText
  tags: string[]
  ordered: boolean
  version: number
  ownerHandle: string
  slug: string
  steps: ExportStep[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Markdown-версия списка. */
export function toMarkdown(list: ExportList, lang: Lang): string {
  const out: string[] = []
  out.push(`# ${tr(list.title, lang)}`, '')
  const desc = tr(list.desc, lang)
  if (desc) out.push(desc, '')
  if (list.tags.length) out.push(`*${list.tags.map((t) => `#${t}`).join(' ')}*`, '')
  out.push(`> ${list.ownerHandle}/${list.slug} · v${list.version}`, '')

  list.steps.forEach((s, i) => {
    const marker = list.ordered ? `${i + 1}.` : '-'
    const lvl = s.level !== 'required' ? ` _(${s.level})_` : ''
    out.push(`${marker} **${tr(s.title, lang)}**${lvl}`)
    const d = tr(s.desc, lang)
    if (d) out.push(`   ${d}`)
    const why = tr(s.why, lang)
    if (why) out.push(`   > Why: ${why}`)
    if (s.command) out.push('', '   ```', `   ${s.command}`, '   ```')
    s.subtasks.forEach((st) => {
      const t = tr(st, lang)
      if (t) out.push(`   - [ ] ${t}`)
    })
    s.refs.forEach((r) => {
      const label = tr(r.label, lang)
      if (label) out.push(r.url ? `   - [${label}](${r.url})` : `   - ${label}`)
    })
    out.push('')
  })
  return out.join('\n')
}

/** Автономный HTML — с печатью без разрыва пунктов (break-inside: avoid). */
export function toHtml(list: ExportList, lang: Lang): string {
  const title = esc(tr(list.title, lang))
  const desc = esc(tr(list.desc, lang))
  const tags = list.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ')

  const steps = list.steps
    .map((s, i) => {
      const marker = list.ordered ? `${i + 1}` : '•'
      const d = esc(tr(s.desc, lang))
      const badge = s.level !== 'required' ? `<span class="lvl">${s.level}</span>` : ''
      const why = esc(tr(s.why, lang))
      const cmd = s.command ? `<pre><code>${esc(s.command)}</code></pre>` : ''
      const subs = s.subtasks
        .map((st) => esc(tr(st, lang)))
        .filter(Boolean)
        .map((t) => `<li>☐ ${t}</li>`)
        .join('')
      const refs = s.refs
        .map((r) => {
          const label = esc(tr(r.label, lang))
          if (!label) return ''
          return r.url ? `<li><a href="${esc(r.url)}">${label}</a></li>` : `<li>${label}</li>`
        })
        .join('')
      return `<div class="step">
  <div class="step-head"><span class="n">${marker}</span><h2>${esc(tr(s.title, lang))}</h2>${badge}</div>
  ${d ? `<p class="d">${d}</p>` : ''}
  ${why ? `<p class="why"><b>Why:</b> ${why}</p>` : ''}
  ${cmd}
  ${subs ? `<ul class="subs">${subs}</ul>` : ''}
  ${refs ? `<ul class="refs">${refs}</ul>` : ''}
</div>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 760px; margin: 2.5rem auto; padding: 0 1.25rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.6rem; margin: 0 0 .4rem; }
  .meta { color: #666; font-size: .85rem; margin: 0 0 1.2rem; }
  .tag { color: #2563eb; font-size: .8rem; margin-right: .3rem; }
  .step { break-inside: avoid; page-break-inside: avoid; border: 1px solid #e3e3e0; border-radius: 8px; padding: .75rem 1rem; margin: .6rem 0; }
  .step-head { display: flex; align-items: baseline; gap: .5rem; }
  .step-head .n { font-family: ui-monospace, monospace; color: #999; font-size: .85rem; }
  .step h2 { font-size: 1rem; margin: 0; }
  .lvl { border: 1px solid #d1a000; color: #a67c00; border-radius: 4px; padding: 0 .35rem; font-size: .68rem; text-transform: capitalize; }
  .why { color: #555; font-size: .85rem; margin: .25rem 0 .1rem; }
  .d { color: #444; margin: .3rem 0 .1rem; }
  pre { background: #f5f5f3; border-radius: 6px; padding: .5rem .7rem; overflow-x: auto; font-size: .82rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  ul.subs, ul.refs { margin: .35rem 0 0; padding-left: 1.1rem; }
  ul.subs { list-style: none; padding-left: .2rem; }
  ul.subs li { color: #444; }
  a { color: #2563eb; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
<h1>${title}</h1>
${desc ? `<p class="d">${desc}</p>` : ''}
<p class="meta">${list.ownerHandle}/${esc(list.slug)} · v${list.version}${tags ? ' · ' + tags : ''}</p>
${steps}
</body>
</html>`
}
