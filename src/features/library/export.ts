// Экспорт списка в Markdown / автономный HTML (для скачивания и печати).
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'

export interface ExportStep {
  n: number
  // Блочная модель: 'step' (дефолт/undefined) | 'text' | 'image'. Не-step блоки
  // презентационные: в скрипте — комментарий, не исполняются.
  type?: string
  content?: Record<string, unknown>
  title: LocaleText
  desc: LocaleText
  command: string
  level: StepLevel
  why: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

const isStepBlk = (s: ExportStep): boolean => !s.type || s.type === 'step'
const blockMd = (s: ExportStep): string => (typeof s.content?.md === 'string' ? s.content.md : '')
const blockImg = (s: ExportStep): { ref: string; caption: string } => ({
  ref: typeof s.content?.ref === 'string' ? s.content.ref : '',
  caption: typeof s.content?.caption === 'string' ? s.content.caption : '',
})
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

  let stepNo = 0
  list.steps.forEach((s) => {
    if (!isStepBlk(s)) {
      // Картинки в экспорт не идут (ключ хранилища не подписан) — оставляем подпись.
      if (s.type === 'text') { const md = blockMd(s); if (md) out.push(md, '') }
      else if (s.type === 'image') { const { caption } = blockImg(s); if (caption) out.push(`_🖼 ${caption}_`, '') }
      return
    }
    stepNo++
    const marker = list.ordered ? `${stepNo}.` : '-'
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

/** Компактный embed-виджет: авто light/dark, фикс-высота с внутренним скроллом,
 *  футер-ссылка назад. Для вставки в <iframe> на внешних сайтах. */
export function embedHtml(list: ExportList, lang: Lang, backUrl: string): string {
  const title = esc(tr(list.title, lang))
  const count = list.steps.filter(isStepBlk).length
  const itemsWord = lang === 'ru' ? 'пунктов' : 'items'
  const openWord = lang === 'ru' ? 'Открыть на SetFork' : 'Open on SetFork'

  let embedNo = 0
  const steps = list.steps
    .map((s) => {
      if (!isStepBlk(s)) {
        const txt = s.type === 'text' ? esc(blockMd(s)) : esc(blockImg(s).caption)
        return txt ? `<li class="step ctx"><span class="n">•</span><div class="body"><p class="d">${txt}</p></div></li>` : ''
      }
      embedNo++
      const marker = list.ordered ? `${embedNo}` : '•'
      const d = esc(tr(s.desc, lang))
      const badge = s.level !== 'required' ? `<span class="lvl">${esc(s.level)}</span>` : ''
      const cmd = s.command ? `<code class="cmd">${esc(s.command)}</code>` : ''
      return `<li class="step"><span class="n">${marker}</span><div class="body"><div class="st">${esc(tr(s.title, lang))}${badge}</div>${d ? `<p class="d">${d}</p>` : ''}${cmd}</div></li>`
    })
    .join('')

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1f2328; --muted:#6b7280; --border:#e5e7eb; --border2:#eceef1; --accent:#2563eb; --chip:#f3f4f6; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --border:#30363d; --border2:#21262d; --accent:#58a6ff; --chip:#161b22; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--fg); font: 13px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  .wrap { display: flex; flex-direction: column; height: 100vh; }
  header { padding: 12px 14px 10px; border-bottom: 1px solid var(--border); }
  .title { font-size: 15px; font-weight: 700; }
  .sub { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
  ol.steps { flex: 1; overflow: auto; list-style: none; margin: 0; padding: 8px 10px; }
  .step { display: flex; gap: 8px; padding: 7px 6px; border-bottom: 1px solid var(--border2); }
  .step:last-child { border-bottom: 0; }
  .n { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; min-width: 16px; text-align: right; }
  .body { min-width: 0; flex: 1; }
  .st { font-weight: 600; }
  .lvl { margin-left: 6px; border: 1px solid var(--border); color: var(--muted); border-radius: 4px; padding: 0 5px; font-size: 10px; text-transform: capitalize; font-weight: 500; }
  .d { color: var(--muted); margin: 2px 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cmd { display: block; margin-top: 4px; background: var(--chip); border-radius: 5px; padding: 3px 7px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; overflow-x: auto; white-space: nowrap; }
  footer { border-top: 1px solid var(--border); padding: 8px 14px; font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; }
  footer a { color: var(--accent); text-decoration: none; font-weight: 600; }
  footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="title">${title}</div>
    <div class="sub">${esc(list.ownerHandle)}/${esc(list.slug)} · v${list.version} · ${count} ${itemsWord}</div>
  </header>
  <ol class="steps">${steps}</ol>
  <footer><span>${count} ${itemsWord}</span><a href="${esc(backUrl)}" target="_blank" rel="noopener">↗ ${openWord}</a></footer>
</div>
</body>
</html>`
}

/** Автономный HTML — с печатью без разрыва пунктов (break-inside: avoid). */
export function toHtml(list: ExportList, lang: Lang): string {
  const title = esc(tr(list.title, lang))
  const desc = esc(tr(list.desc, lang))
  const tags = list.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ')

  let htmlNo = 0
  const steps = list.steps
    .map((s) => {
      if (!isStepBlk(s)) {
        if (s.type === 'text') { const md = esc(blockMd(s)); return md ? `<div class="block-text"><p>${md}</p></div>` : '' }
        const { caption } = blockImg(s)
        return caption ? `<div class="block-text"><p>🖼 ${esc(caption)}</p></div>` : ''
      }
      htmlNo++
      const marker = list.ordered ? `${htmlNo}` : '•'
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
  .block-text { color: #444; margin: .7rem .2rem; line-height: 1.55; }
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

// Все три диалекта комментируют через «# …» — общий хелпер (без хвостовых пробелов).
function hashComment(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => `# ${l}`.replace(/\s+$/, ''))
    .join('\n')
}
// Экранирование строк для echo/print каждого диалекта (переводы строк → пробел).
const escSh = (s: string) => s.replace(/\r?\n/g, ' ').replace(/'/g, `'\\''`)
const escPs = (s: string) => s.replace(/\r?\n/g, ' ').replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$')
const escPy = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')

export type ScriptDialect = 'sh' | 'ps1' | 'py'
export function normalizeDialect(v: string | null | undefined): ScriptDialect {
  const s = (v ?? '').toLowerCase()
  if (s === 'ps1' || s === 'powershell' || s === 'pwsh') return 'ps1'
  if (s === 'py' || s === 'python') return 'py'
  return 'sh'
}

interface DialectSpec {
  shebang: string | null
  pre: string | null // строка, задающая «стоп на первой ошибке»
  echo: (s: string) => string // прогресс-строка
  run: (url: string) => string // one-liner для запуска из шапки
  ext: string
  mime: string
}
const DIALECTS: Record<ScriptDialect, DialectSpec> = {
  sh: {
    shebang: '#!/usr/bin/env bash',
    pre: 'set -euo pipefail',
    echo: (s) => `echo '${escSh(s)}'`,
    run: (u) => `curl -fsSL ${u} | bash`,
    ext: 'sh',
    mime: 'text/x-shellscript; charset=utf-8',
  },
  ps1: {
    shebang: null, // PowerShell без shebang
    pre: "$ErrorActionPreference = 'Stop'",
    echo: (s) => `Write-Host "${escPs(s)}"`,
    run: (u) => `irm "${u}?lang=ps1" | iex`,
    ext: 'ps1',
    mime: 'text/plain; charset=utf-8',
  },
  py: {
    shebang: '#!/usr/bin/env python3',
    pre: null, // в python необработанное исключение и так останавливает скрипт
    echo: (s) => `print("${escPy(s)}")`,
    run: (u) => `curl -fsSL "${u}?lang=py" | python3`,
    ext: 'py',
    mime: 'text/x-python; charset=utf-8',
  },
}
export const dialectExt = (d: ScriptDialect) => DIALECTS[d].ext
export const dialectMime = (d: ScriptDialect) => DIALECTS[d].mime

/**
 * «Raw»-версия списка как исполняемый скрипт (аналог gist «curl … | bash»):
 * заголовки/описания/зачем → комментарии, echo-прогресс перед каждым шагом,
 * поле command → сами команды построчно. Диалект оборачивает (shebang, echo,
 * стоп-на-ошибке); сами команды — авторские, за совместимость отвечает автор.
 * `url` — абсолютный адрес raw-эндпоинта (без ?lang, для шапки-подсказки).
 */
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
/** Уникальные `${VAR}`-плейсхолдеры во всех командах (по порядку появления). */
function scriptVariables(list: ExportList): string[] {
  const seen = new Set<string>()
  for (const s of list.steps) {
    for (const m of (s.command ?? '').matchAll(VAR_RE)) seen.add(m[1])
  }
  return [...seen]
}

export function toRunnableScript(list: ExportList, lang: Lang, url: string, dialect: ScriptDialect = 'sh'): string {
  const d = DIALECTS[dialect]
  const title = tr(list.title, lang)
  const vars = scriptVariables(list) // опционально: нет ${VAR} → скрипт как раньше
  const out: string[] = []
  if (d.shebang) out.push(d.shebang)
  out.push(hashComment(title))
  out.push(`# ${list.ownerHandle}/${list.slug} · v${list.version} · ${url}`)
  const desc = tr(list.desc, lang)
  if (desc) out.push(hashComment(desc))
  out.push('#', '# ⚠  Review before running — this script comes from a SetFork list, not from you.', `#    Run:  ${d.run(url)}`)
  if (vars.length) out.push(`#    Required variables (pass as env): ${vars.map((v) => `${v}=…`).join(' ')}`)
  out.push('')
  if (d.pre) out.push(d.pre, '')
  // Guard-преамбула: падать понятно, если переменная не задана (sh/ps1 нативно).
  if (vars.length) {
    if (dialect === 'sh') vars.forEach((v) => out.push(`: "\${${v}:?set ${v}}"`))
    else if (dialect === 'ps1') vars.forEach((v) => out.push(`if (-not $env:${v}) { throw 'set ${v}' }; $${v} = $env:${v}`))
    // py: команды на python, ${VAR} не их синтаксис — ограничиваемся строкой Required variables выше.
    if (dialect !== 'py') out.push('')
  }

  let scriptNo = 0
  list.steps.forEach((s) => {
    // Не-step блоки — только контекст: комментарий (text) / подпись (image),
    // ничего не исполняется. Нумерация идёт только по шаг-блокам.
    if (!isStepBlk(s)) {
      if (s.type === 'text') { const md = blockMd(s); if (md) out.push(hashComment(md), '') }
      else if (s.type === 'image') { const { caption } = blockImg(s); if (caption) out.push(hashComment(`🖼 ${caption}`), '') }
      return
    }
    scriptNo++
    const n = scriptNo
    const st = tr(s.title, lang)
    out.push(`# ── ${n}. ${st} ${'─'.repeat(Math.max(3, 50 - st.length))}`)
    const dd = tr(s.desc, lang)
    if (dd) out.push(hashComment(dd))
    const why = tr(s.why, lang)
    if (why) out.push(hashComment(`Why: ${why}`))
    out.push(d.echo(`==> ${n}. ${st}`))
    if (s.command && s.command.trim()) {
      out.push(s.command.trim())
    } else {
      s.subtasks.forEach((stk) => {
        const tt = tr(stk, lang)
        if (tt) out.push(d.echo(`     - ${tt}`))
      })
    }
    out.push('')
  })
  out.push(d.echo(`✓ ${title} — done`), '')
  return out.join('\n')
}
