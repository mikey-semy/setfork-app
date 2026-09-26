import { parse as parseYaml } from 'yaml'

/**
 * РАЗБОР `SKILL.md` В БЛОКИ СПИСКА — обратная к `toSkillMarkdown` (skill.ts).
 *
 * Решение владельца 24.09.2026: «блоки — правда». Импорт раскладывает скилл в блоки, а
 * экспорт собирает его обратно; байты исходника не хранятся. Поэтому разбор обязан
 * понимать и СВОЙ вывод (круг «экспорт → разбор → экспорт» не должен ничего терять), и
 * чужой скилл, где инструкция — свободная проза.
 *
 * Правила, по которым текст становится блоками:
 *  • `## Заголовок` — раздел (`section`) следующих блоков;
 *  • пункт НУМЕРОВАННОГО списка на верхнем уровне — шаг: процедура в скиллах пишется
 *    именно так. Пункт маркированного списка — шаг, только если начинается с `**жирного**`
 *    (так наш экспорт пишет шаги неупорядоченного списка); прочие маркеры — заметки,
 *    остаются текстом;
 *  • внутри шага: `Why:` → зачем, `Check:` + `- [ ]` → подпункты, `See:` + ссылки → ссылки,
 *    блок кода → команда, метки `🧑 NEEDS A HUMAN` и `⚠ DESTRUCTIVE` → флаги, `_(optional)_`
 *    у заголовка → уровень; остальное — описание;
 *  • всё прочее (абзацы, таблицы, код вне пунктов, цитаты) — текстовые блоки по порядку.
 *
 * Шум нашего же экспорта (предупреждение, ссылки на архив, строка «Source:») выбрасывается:
 * иначе каждый круг добавлял бы его в список ещё раз.
 */

export interface ParsedSkillBlock {
  type?: 'step' | 'text'
  title?: string
  desc?: string
  command?: string
  level?: 'required' | 'recommended' | 'optional'
  why?: string
  section?: string
  subtasks?: string[]
  refs?: { label: string; url?: string }[]
  text?: string
  needsHuman?: boolean
  needsHumanAsk?: string
  danger?: boolean
}

export interface ParsedSkill {
  /** Имя из шапки (`name`) — годится в адрес списка. */
  name: string
  description: string
  /**
   * Название списка. У чужого скилла — `name` из шапки: это имя, под которым скилл знают
   * (решение владельца 26.09.2026, «имя — name»), а заголовок `# …` — оформление тела. У
   * нашего же экспорта наоборот: `name` там — слаг, а название написано заголовком.
   */
  title: string
  /** Заголовок `# …` тела, если он не совпал с названием: экспорт вернёт его как был. */
  heading?: string
  /** Прочие поля шапки как есть (license, compatibility, metadata…). */
  header: Record<string, unknown>
  items: ParsedSkillBlock[]
  /** Что разобрано с допущениями — чтобы сказать человеку, а не промолчать. */
  warnings: string[]
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const OL = /^(\d+)[.)]\s+(.*)$/
const UL = /^[-*+]\s+(.*)$/
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/
const LEVEL = /\s*_\((required|recommended|optional)\)_\s*$/
const HUMAN = /^🧑 NEEDS A HUMAN — stop here and ask the human(?:: (.*?))?(?: before doing this step)?\. Do not do it yourself\.$/
const DANGER = /^⚠ DESTRUCTIVE \(.*?\) — /

/**
 * Граница текстового блока, который без неё разобрался бы не тем: в нём строка вида
 * «1. …» (стала бы шагом), заголовок (стал бы разделом), он стоит вплотную к другому
 * тексту (слился бы с ним) или начинается отступом сразу после шага (ушёл бы в шаг).
 * HTML-комментарий в отрисованном markdown не виден. Экспорт ставит его ТОЛЬКО там, где
 * без него круг «экспорт → разбор» потерял бы блок (`textNeedsFence`), поэтому скилл,
 * пришедший чужим SKILL.md, возвращается без них.
 */
export const TEXT_OPEN = '<!-- setfork:text -->'
export const TEXT_CLOSE = '<!-- /setfork:text -->'

/** Строки нашего собственного экспорта, которые в список возвращаться не должны. */
const NOISE = [
  /^> ⚠ Review before use/,
  /^Background and the reasoning behind the steps:/,
  /^All commands as one script:/,
  /^This file is the instructions only\./,
  /^Files from the author, exactly as in this version/,
]

/** `**Заголовок.** продолжение` → заголовок и хвост строки. Наш экспорт пишет после
 *  жирного только метку уровня (`_(optional)_`), чужой скилл — часто начало описания. */
function stripBold(s: string): { title: string; bold: boolean; rest: string } {
  const m = /^\*\*(.+?)\*\*(.*)$/.exec(s.trim())
  if (!m) return { title: s.trim(), bold: false, rest: '' }
  const tail = m[2].trim()
  if (!tail || LEVEL.test(` ${tail}`)) return { title: (m[1] + m[2]).trim(), bold: true, rest: '' }
  return { title: m[1].trim().replace(/[.:]$/, ''), bold: true, rest: tail }
}

export function parseSkillMd(md: string): ParsedSkill {
  const warnings: string[] = []
  let header: Record<string, unknown> = {}
  let body = md.replace(/^﻿/, '')
  const fm = FRONT.exec(body)
  if (fm) {
    try {
      // failsafe: все значения — строками, как написаны. Иначе `version: 1.0` читался бы
      // числом 1, а имя «1984» — числом, и круг «импорт → экспорт» менял бы шапку.
      const y = parseYaml(fm[1], { schema: 'failsafe' })
      if (y && typeof y === 'object' && !Array.isArray(y)) header = y as Record<string, unknown>
      else warnings.push('the frontmatter is not a key-value map — ignored')
    } catch (e) {
      warnings.push(`the frontmatter is not valid YAML — ignored (${(e as Error).message.split('\n')[0]})`)
    }
    body = body.slice(fm[0].length)
  } else {
    warnings.push('no frontmatter — name and description are taken from the body')
  }
  const name = typeof header.name === 'string' ? header.name.trim() : ''
  const description = typeof header.description === 'string' ? header.description.trim() : ''
  const { name: _n, description: _d, ...rest } = header

  const lines = body.replace(/\r\n/g, '\n').split('\n')
  // Хвост нашего экспорта: `---` и строка «Source: …» — это подпись, а не содержимое.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^Source: \[/.test(lines[i])) {
      let j = i - 1
      while (j >= 0 && !lines[j].trim()) j--
      if (lines[j] === '---') lines.splice(j)
      break
    }
  }

  const items: ParsedSkillBlock[] = []
  let h1 = ''
  // Наш экспорт метит шапку `metadata.setfork-ref` — по ней и узнаём свой файл.
  const meta = header.metadata
  const fromSetfork = !!meta && typeof meta === 'object' && 'setfork-ref' in meta
  let section = ''
  let text: string[] = []

  const flushText = () => {
    const t = text.join('\n').trim()
    text = []
    if (!t) return
    items.push({ type: 'text', text: t, ...(section ? { section } : {}) })
  }

  let i = 0
  let skipAuthorList = false
  while (i < lines.length) {
    const line = lines[i]

    if (skipAuthorList) {
      if (/^- \[.+\]\(.+\)$/.test(line) || !line.trim()) {
        i++
        continue
      }
      skipAuthorList = false
    }
    if (NOISE.some((re) => re.test(line))) {
      if (/^Files from the author/.test(line)) skipAuthorList = true
      i++
      continue
    }

    if (line.trim() === TEXT_OPEN) {
      flushText()
      let end = i + 1
      while (end < lines.length && lines[end].trim() !== TEXT_CLOSE) end++
      const t = lines.slice(i + 1, end).join('\n').trim()
      if (t) items.push({ type: 'text', text: t, ...(section ? { section } : {}) })
      i = end + 1
      continue
    }

    const h = HEADING.exec(line)
    // Заголовок внутри блока кода сюда не доходит: ограждение ниже съедает код целиком.
    if (h) {
      flushText()
      if (h[1].length === 1 && !h1) {
        h1 = h[2]
        // Абзац сразу под заголовком, равный описанию, — наш же экспорт его повторяет.
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j++
        const para: string[] = []
        while (j < lines.length && lines[j].trim() && !HEADING.test(lines[j])) para.push(lines[j++])
        if (para.length && description && para.join(' ').replace(/\s+/g, ' ').trim() === description.replace(/\s+/g, ' ')) {
          i = j
          continue
        }
      } else if (h[1].length === 2 && h[2] === 'Media') {
        section = ''
      } else {
        section = h[2]
      }
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence && !fence[1]) {
      // Код ВНЕ пункта — часть текста как есть.
      const end = closeFence(lines, i, fence[2])
      text.push(...lines.slice(i, end + 1))
      i = end + 1
      continue
    }

    const ol = OL.exec(line)
    const ul = UL.exec(line)
    const isStep = ol ? true : ul ? stripBold(ul[1]).bold : false
    if (isStep) {
      flushText()
      const head = ol ? ol[2] : ul![1]
      const marker = ol ? `${ol[1]}. ` : '- '
      const [block, next] = readStep(lines, i, head, marker.length)
      items.push({ ...block, ...(section ? { section } : {}) })
      i = next
      continue
    }

    text.push(line)
    i++
  }
  flushText()

  const title = (fromSetfork ? h1 || name : name || h1) || 'Imported skill'
  if (!name) warnings.push('no name in the frontmatter — the address is taken from the title')
  if (!description) warnings.push('no description — agents decide by it whether to use the skill; add one')
  const heading = !fromSetfork && h1 && h1 !== title ? h1 : undefined
  return { name, description, title, ...(heading ? { heading } : {}), header: rest, items, warnings }
}

function closeFence(lines: string[], from: number, mark: string): number {
  for (let k = from + 1; k < lines.length; k++) {
    const f = FENCE.exec(lines[k])
    if (f && f[2][0] === mark[0] && f[2].length >= mark.length && !f[3]) return k
  }
  return lines.length - 1
}

/** Пункт-шаг: заголовок и всё, что отступлено под ним (или идёт до следующего пункта). */
function readStep(lines: string[], at: number, head: string, indentWidth: number): [ParsedSkillBlock, number] {
  const { title: raw, rest } = stripBold(head)
  const lvl = LEVEL.exec(raw)
  const block: ParsedSkillBlock = { type: 'step', title: raw.replace(LEVEL, '').trim() }
  if (lvl) block.level = lvl[1] as ParsedSkillBlock['level']

  const desc: string[] = rest ? [rest] : []
  let k = at + 1
  let mode: 'desc' | 'check' | 'see' = 'desc'
  while (k < lines.length) {
    const line = lines[k]
    if (line.trim() && !/^\s/.test(line)) break // следующий пункт, заголовок или текст верхнего уровня
    const body = line.slice(Math.min(indentWidth, line.length - line.trimStart().length))
    const t = body.trim()
    const fence = FENCE.exec(body)
    if (fence) {
      const end = closeFence(lines, k, fence[2])
      const code = lines
        .slice(k + 1, end)
        .map((l) => l.slice(Math.min(indentWidth, l.length - l.trimStart().length)))
        .join('\n')
      if (!block.command) block.command = code
      else desc.push('```' + (fence[3] || ''), code, '```')
      k = end + 1
      mode = 'desc'
      continue
    }
    if (!t) {
      if (mode === 'desc') desc.push('')
      k++
      continue
    }
    const human = HUMAN.exec(t)
    if (human) {
      block.needsHuman = true
      if (human[1]) block.needsHumanAsk = human[1]
    } else if (DANGER.test(t)) {
      block.danger = true
    } else if (/^Why:\s*/.test(t)) {
      block.why = t.replace(/^Why:\s*/, '')
    } else if (t === 'Check:') {
      mode = 'check'
    } else if (t === 'See:') {
      mode = 'see'
    } else if (mode === 'check' && /^- \[[ xX]\]\s+/.test(t)) {
      ;(block.subtasks ??= []).push(t.replace(/^- \[[ xX]\]\s+/, ''))
    } else if (mode === 'see' && /^- /.test(t)) {
      const link = /^- \[(.+?)\]\((.+?)\)$/.exec(t)
      ;(block.refs ??= []).push(link ? { label: link[1], url: link[2] } : { label: t.slice(2) })
    } else {
      mode = 'desc'
      desc.push(body)
    }
    k++
  }
  const d = desc.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (d) block.desc = d
  return [block, k]
}

/**
 * Нужна ли тексту граница (`TEXT_OPEN`/`TEXT_CLOSE`), чтобы круг «экспорт → разбор» вернул
 * его одним блоком, как есть. Решает сам разбор, а не список примет: текст, который
 * разбор в одиночку понимает иначе, чем одним текстовым блоком, — в границу. Плюс места,
 * которые одиночный разбор не видит: соседний текст (слился бы) и отступ сразу после шага
 * (ушёл бы в шаг).
 */
export function textNeedsFence(md: string, prev: 'text' | 'step' | null): boolean {
  if (prev === 'text') return true
  if (prev === 'step' && /^\s/.test(md)) return true
  // Первым после перечня файлов автора: строку-ссылку разбор счёл бы продолжением перечня.
  if (prev === null && /^- \[.+\]\(.+\)/.test(md.trimStart())) return true
  const alone = parseSkillMd(`---\nname: x\n---\n${md}\n`).items
  return !(alone.length === 1 && alone[0].type === 'text' && alone[0].text === md.trim() && !alone[0].section)
}

