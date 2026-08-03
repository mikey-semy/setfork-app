import { describe, expect, it } from 'vitest'
import { codeLabel, detectCodeLang } from '@/shared/lib/detect-code-lang'

describe('detectCodeLang', () => {
  it('python по объявлениям и импортам', () => {
    expect(detectCodeLang('import subprocess\n\ndef lint() -> None:\n    print("ok")')).toBe('python')
  })

  it('bash по утилитам и по приглашению', () => {
    expect(detectCodeLang('winget install Microsoft.VisualStudioCode')).toBe('bash')
    expect(detectCodeLang('$ code --version')).toBe('bash')
    expect(detectCodeLang('#!/usr/bin/env bash\nset -e')).toBe('bash')
  })

  it('toml по секции и присваиванию — это кейс pyproject', () => {
    expect(detectCodeLang('[project.scripts]\nlint = "scripts.commands:lint"')).toBe('toml')
  })

  it('json по кавычкам-ключам в объекте', () => {
    expect(detectCodeLang('{\n  "name": "setfork",\n  "private": true\n}')).toBe('json')
  })

  it('yaml по ключам без фигурных скобок', () => {
    expect(detectCodeLang('services:\n  db:\n    image: postgres:17')).toBe('yaml')
  })

  it('typescript отличается от javascript по типам', () => {
    expect(detectCodeLang('interface User { id: string }')).toBe('typescript')
    expect(detectCodeLang('const x = 1\nconsole.log(x)')).toBe('javascript')
  })

  it('sql, rust, dockerfile, diff', () => {
    expect(detectCodeLang('SELECT id FROM users WHERE id = 1')).toBe('sql')
    expect(detectCodeLang('pub fn main() { let mut n = 1; }')).toBe('rust')
    expect(detectCodeLang('FROM node:22\nRUN npm ci')).toBe('dockerfile')
    expect(detectCodeLang('@@ -1,3 +1,4 @@\n-old\n+new')).toBe('diff')
  })

  it('непонятный текст — честный null, а не догадка', () => {
    expect(detectCodeLang('просто текст без кода')).toBeNull()
    expect(detectCodeLang('')).toBeNull()
  })
})

describe('codeLabel', () => {
  it('язык из ограды главнее опознанного', () => {
    expect(codeLabel('python', 'SELECT 1')).toBe('python')
  })

  it('без ограды подставляет опознанный', () => {
    expect(codeLabel(undefined, 'import os')).toBe('python')
  })

  it('не опознали — нейтральная подпись', () => {
    expect(codeLabel(undefined, 'бла бла')).toBe('code')
  })
})
