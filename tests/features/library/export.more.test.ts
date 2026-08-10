import { describe, expect, it } from 'vitest'
import { toHtml, embedHtml, toRunnableScript, type ExportList, type ExportStep } from '@/features/library/export'
import { normalizeDialect } from '@/core/domain/script-dialect'

const step = (over: Partial<ExportStep> = {}): ExportStep => ({
  n: 1,
  title: { en: 'Install' },
  desc: {},
  command: '',
  level: 'required',
  why: {},
  subtasks: [],
  refs: [],
  ...over,
})
const list = (steps: ExportStep[], over: Partial<ExportList> = {}): ExportList => ({
  title: { en: 'Deploy' },
  desc: {},
  tags: [],
  ordered: true,
  version: 1,
  ownerHandle: 'acme',
  slug: 'deploy',
  steps,
  ...over,
})

describe('normalizeDialect', () => {
  it('распознаёт алиасы, дефолт — sh', () => {
    expect(normalizeDialect('ps1')).toBe('ps1')
    expect(normalizeDialect('powershell')).toBe('ps1')
    expect(normalizeDialect('pwsh')).toBe('ps1')
    expect(normalizeDialect('PY')).toBe('py')
    expect(normalizeDialect('python')).toBe('py')
    expect(normalizeDialect('sh')).toBe('sh')
    expect(normalizeDialect(null)).toBe('sh')
    expect(normalizeDialect(undefined)).toBe('sh')
    expect(normalizeDialect('nonsense')).toBe('sh')
  })
})

describe('toRunnableScript — диалекты', () => {
  const one = list([step({ title: { en: 'Run it' }, command: 'echo hi' })])

  it('sh: shebang + set -euo pipefail + echo + голая команда', () => {
    const out = toRunnableScript(one, 'en', 'https://x/raw', 'sh')
    expect(out.startsWith('#!/usr/bin/env bash')).toBe(true)
    expect(out).toContain('set -euo pipefail')
    expect(out).toContain("echo '==> 1. Run it'")
    expect(out).toContain('echo hi')
    // Команда СКАЧИВАЕТ во временный каталог и только потом запускает: конвейер
    // `curl -f … | bash` при отказе сервера возвращает ноль и сходит за успешный
    // прогон, а скачивание рядом затёрло бы чужой файл с тем же именем (карточка 014).
    expect(out).toContain('d=$(mktemp -d) && curl -fsSL "https://x/raw" -o "$d/deploy.sh" && bash "$d/deploy.sh"')
  })

  it('ps1: без shebang, ErrorActionPreference, Write-Host', () => {
    const out = toRunnableScript(one, 'en', 'https://x/raw', 'ps1')
    expect(out.startsWith('#!')).toBe(false)
    expect(out).toContain("$ErrorActionPreference = 'Stop'")
    expect(out).toContain('Write-Host "==> 1. Run it"')
  })

  it('py: python-shebang, без set -e, print()', () => {
    const out = toRunnableScript(one, 'en', 'https://x/raw', 'py')
    expect(out.startsWith('#!/usr/bin/env python3')).toBe(true)
    expect(out).not.toContain('set -euo pipefail')
    expect(out).toContain('print("==> 1. Run it")')
  })

  it('нет команды → подзадачи идут echo-строками', () => {
    const out = toRunnableScript(list([step({ title: { en: 'Check' }, subtasks: [{ en: 'verify a' }] })]), 'en', 'u', 'sh')
    expect(out).toContain("echo '     - verify a'")
  })

  it('${VAR} → «Required variables» + guard-преамбула по диалекту', () => {
    const l = list([step({ command: 'deploy --token ${TOKEN} --env ${ENV}' })])
    const sh = toRunnableScript(l, 'en', 'u', 'sh')
    expect(sh).toContain('Required variables')
    expect(sh).toContain(': "${TOKEN:?set TOKEN}"')
    expect(sh).toContain(': "${ENV:?set ENV}"')
    const ps = toRunnableScript(l, 'en', 'u', 'ps1')
    expect(ps).toContain("if (-not $env:TOKEN) { throw 'set TOKEN' }")
  })

  it('escSh: одинарная кавычка в прогресс-строке экранируется', () => {
    const out = toRunnableScript(list([step({ title: { en: "it's done" }, command: 'x' })]), 'en', 'u', 'sh')
    expect(out).toContain("it'\\''s done")
  })

  it('escPy: двойная кавычка экранируется', () => {
    const out = toRunnableScript(list([step({ title: { en: 'say "hi"' }, command: 'x' })]), 'en', 'u', 'py')
    expect(out).toContain('say \\"hi\\"')
  })

  it('poll/video блоки → комментарии, не исполняются', () => {
    const l = list([
      step({ n: 1, type: 'poll', title: {}, content: { question: 'Which?', options: [{ text: 'A' }, { text: 'B' }] } }),
      step({ n: 2, type: 'video', title: {}, content: { url: 'https://v/1', caption: 'demo' } }),
    ])
    const out = toRunnableScript(l, 'en', 'u', 'sh')
    expect(out).toMatch(/#.*Which\?/)
    expect(out).toMatch(/#.*demo/)
    expect(out).not.toContain('\nhttps://v/1') // url не голой строкой
  })
})

describe('toHtml — экранирование и безопасные ссылки', () => {
  it('XSS в заголовке экранируется (нет живого <script>)', () => {
    const html = toHtml(list([step()], { title: { en: '<script>alert(1)</script>' } }), 'en')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('ref с javascript:-URL не становится <a> (safeHref), label остаётся', () => {
    const html = toHtml(list([step({ refs: [{ label: { en: 'evil' }, url: 'javascript:alert(1)' }] })]), 'en')
    expect(html).not.toMatch(/<a[^>]*javascript:/i)
    expect(html).toContain('evil')
  })

  it('безопасный https ref → <a href>', () => {
    const html = toHtml(list([step({ refs: [{ label: { en: 'Docs' }, url: 'https://d' }] })]), 'en')
    expect(html).toMatch(/<a href="https:\/\/d">Docs<\/a>/)
  })

  it('бейдж уровня только для не-required', () => {
    expect(toHtml(list([step({ level: 'optional' })]), 'en')).toContain('class="lvl"')
    expect(toHtml(list([step({ level: 'required' })]), 'en')).not.toContain('class="lvl"')
  })
})

describe('embedHtml', () => {
  it('экранирует заголовок и backUrl, считает шаг-блоки', () => {
    const l = list([step({ title: { en: 'A' } }), step({ n: 2, type: 'text', title: {}, content: { md: 'note' } })])
    const html = embedHtml(l, 'en', 'https://back"x')
    expect(html).toContain('<title>Deploy</title>')
    expect(html).toContain('1 items') // ровно 1 шаг-блок (text не считается)
    expect(html).not.toContain('href="https://back"x"') // кавычка в URL экранирована
  })
})
