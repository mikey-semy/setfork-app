// Подсветка кода БЕЗ горизонтального скролла и с номерами строк: highlight.js через
// lowlight отдаёт hast-дерево, мы раскладываем его в токены ПО СТРОКАМ. Готовый HTML
// от highlight.js для нашей карточки не подходит — резать его по \n нельзя, теги
// многострочных строк и комментариев остались бы незакрытыми.
//
// Языки регистрируем поштучно (не `all`): в бандл едет только то, что реально
// встречается в списках. Новый язык — одна строка в LANGUAGES.
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// ini покрывает и toml (секции + key=value) — отдельной грамматики в highlight.js нет.
const LANGUAGES: Record<string, Parameters<ReturnType<typeof createLowlight>['register']>[1]> = {
  bash, css, diff, dockerfile, go, ini, javascript, json, python, rust, sql, typescript, xml, yaml,
}

const ALIASES: Record<string, string> = {
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', cmd: 'bash', powershell: 'bash',
  toml: 'ini', conf: 'ini', cfg: 'ini',
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rs: 'rust', golang: 'go', yml: 'yaml', html: 'xml', svg: 'xml', vue: 'xml',
  postgres: 'sql', postgresql: 'sql', psql: 'sql', patch: 'diff',
}

const lowlight = createLowlight(LANGUAGES)

export interface CodeToken {
  text: string
  /** Класс токена highlight.js (`hljs-keyword` и т.п.); пусто — обычный текст. */
  cls: string
}

/** Приводим язык из ограды/детектора к грамматике; null — подсветки не будет. */
export function resolveHighlightLang(lang: string | undefined): string | null {
  if (!lang) return null
  const key = lang.toLowerCase()
  const name = ALIASES[key] ?? key
  return name in LANGUAGES ? name : null
}

/** hast-узел highlight.js: либо текст, либо span с классами. */
interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

/**
 * Токены построчно. Разрыв строки внутри токена (многострочный комментарий,
 * docstring) продолжает тот же класс на следующей строке — именно поэтому обходим
 * дерево сами, а не режем HTML.
 */
export function highlightLines(code: string, lang: string | undefined): CodeToken[][] {
  const name = resolveHighlightLang(lang)
  const body = code.replace(/\n$/, '')
  if (!name) return body.split('\n').map((line) => [{ text: line, cls: '' }])

  let tree: HastNode
  try {
    tree = lowlight.highlight(name, body) as unknown as HastNode
  } catch {
    // Грамматика подавилась — показываем код как есть, это не повод терять содержимое.
    return body.split('\n').map((line) => [{ text: line, cls: '' }])
  }

  const lines: CodeToken[][] = [[]]
  const push = (text: string, cls: string) => {
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, cls })
    })
  }
  const walk = (node: HastNode, cls: string) => {
    if (node.type === 'text') {
      push(node.value ?? '', cls)
      return
    }
    const own = node.properties?.className?.join(' ') ?? ''
    const next = own || cls
    for (const child of node.children ?? []) walk(child, next)
  }
  for (const child of tree.children ?? []) walk(child, '')
  return lines
}
