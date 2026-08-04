import { describe, expect, it } from 'vitest'
import { markdownCodeBlock } from '@/shared/lib/markdown'

// Команду пишет автор списка, а экспорт кладёт её в блок кода. Если ограждение
// фиксированное, автор закрывает его изнутри — и остаток документа перестаёт быть
// кодом: в рендерере с разрешённым HTML это сохранённый XSS.

/** Строка закрывает блок, если состоит только из кавычек и их не меньше открывающих. */
const closesFence = (lines: string[]): boolean => {
  const open = lines[0].trim()
  const n = open.length - open.replace(/^`+/, '').length
  return lines.slice(1, -1).some((l) => {
    const t = l.trim()
    return /^`+$/.test(t) && t.length >= n
  })
}

describe('блок кода нельзя закрыть изнутри', () => {
  it.each([3, 4, 5, 8, 10])('%s обратных кавычек в команде не закрывают блок', (n) => {
    const payload = `echo ok\n${'`'.repeat(n)}\n<img src=x onerror=alert(1)>`
    const lines = markdownCodeBlock(payload)
    expect(closesFence(lines)).toBe(false)
    // Ограждение длиннее содержимого — ровно по CommonMark §4.5.
    expect(lines[0].length).toBeGreaterThan(n)
    // Полезная нагрузка осталась внутри и не стала отдельным HTML-узлом.
    expect(lines.slice(1, -1)).toContain('<img src=x onerror=alert(1)>')
  })

  it('цепочка кавычек ВНУТРИ строки тоже учитывается', () => {
    // Такая строка не «ограждение», но открой мы блок тремя кавычками — разметка
    // всё равно поедет: считаем максимальную цепочку где угодно.
    const lines = markdownCodeBlock('echo ```` inline')
    expect(lines[0]).toBe('`````')
  })

  it('обычная команда получает привычные три кавычки', () => {
    expect(markdownCodeBlock('npm ci')).toEqual(['```', 'npm ci', '```'])
  })

  it('открывающее и закрывающее ограждение одной длины', () => {
    const lines = markdownCodeBlock('a\n```\nb')
    expect(lines[0]).toBe(lines[lines.length - 1])
  })
})

describe('форма блока', () => {
  it('отступ получает КАЖДАЯ строка — иначе многострочная команда выпадает из пункта', () => {
    expect(markdownCodeBlock('cd /tmp\nmake', { indent: '   ' })).toEqual(['   ```', '   cd /tmp', '   make', '   ```'])
  })

  it('CRLF и одиночный \\r приводятся к переводу строки', () => {
    expect(markdownCodeBlock('a\r\nb\rc')).toEqual(['```', 'a', 'b', 'c', '```'])
  })

  it('язык ставится у открывающего ограждения', () => {
    expect(markdownCodeBlock('ls', { lang: 'sh' })[0]).toBe('```sh')
  })

  it('пустая команда остаётся пустым блоком, а не съезжает', () => {
    expect(markdownCodeBlock('')).toEqual(['```', '', '```'])
  })
})
