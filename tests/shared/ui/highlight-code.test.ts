import { describe, expect, it } from 'vitest'
import { highlightLines, resolveHighlightLang } from '@/shared/ui/highlight-code'

const text = (lines: ReturnType<typeof highlightLines>) => lines.map((l) => l.map((t) => t.text).join('')).join('\n')

describe('resolveHighlightLang', () => {
  it('знакомые языки и синонимы', () => {
    expect(resolveHighlightLang('python')).toBe('python')
    expect(resolveHighlightLang('sh')).toBe('bash')
    expect(resolveHighlightLang('TOML')).toBe('ini')
    expect(resolveHighlightLang('tsx')).toBe('typescript')
  })

  it('незнакомый язык и пустота — без подсветки', () => {
    expect(resolveHighlightLang('brainfuck')).toBeNull()
    expect(resolveHighlightLang(undefined)).toBeNull()
  })
})

describe('highlightLines', () => {
  it('текст кода не теряется и не меняется', () => {
    const code = 'def lint() -> None:\n    result = run(["ruff"])\n    sys.exit(result.returncode)'
    expect(text(highlightLines(code, 'python'))).toBe(code)
  })

  it('ключевые слова получают класс highlight.js', () => {
    const lines = highlightLines('def lint():\n    pass', 'python')
    expect(lines[0].some((t) => t.cls.includes('hljs-keyword') && t.text === 'def')).toBe(true)
  })

  it('строки разбиты ровно по переводам строк', () => {
    expect(highlightLines('a = 1\nb = 2\nc = 3', 'python')).toHaveLength(3)
  })

  it('многострочный литерал продолжает свой класс на следующей строке', () => {
    const lines = highlightLines('"""Команды проекта.\nВторая строка."""\nimport sys', 'python')
    expect(lines).toHaveLength(3)
    expect(lines[1].every((t) => t.cls.includes('hljs-string'))).toBe(true)
  })

  it('без языка — просто строки, содержимое целое', () => {
    const lines = highlightLines('какой-то текст\nвторая строка', undefined)
    expect(lines).toHaveLength(2)
    expect(lines[0][0].cls).toBe('')
  })

  it('хвостовой перевод строки не рождает пустую строку', () => {
    expect(highlightLines('a = 1\n', 'python')).toHaveLength(1)
  })

  it('toml через ini: секция и ключ подсвечены', () => {
    const lines = highlightLines('[project.scripts]\nlint = "scripts.commands:lint"', 'toml')
    expect(text(lines)).toContain('[project.scripts]')
    expect(lines.flat().some((t) => t.cls !== '')).toBe(true)
  })
})
