import { describe, expect, it } from 'vitest'
import { toMarkdown, toRunnableScript, type ExportList, type ExportStep } from '@/features/library/export'

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

const list = (steps: ExportStep[]): ExportList => ({
  title: { en: 'Deploy' },
  desc: {},
  tags: [],
  ordered: true,
  version: 1,
  ownerHandle: 'acme',
  slug: 'deploy',
  steps,
})

describe('export — блочная модель', () => {
  const mixed = [
    step({ n: 1, title: { en: 'First' }, command: 'echo one' }),
    step({ n: 2, type: 'text', title: {}, content: { md: 'Some **note**' } }),
    step({ n: 3, type: 'image', title: {}, content: { ref: 'k/1', caption: 'a shot' } }),
    step({ n: 4, title: { en: 'Second' }, command: 'echo two' }),
  ]

  it('toRunnableScript: только шаг-команды исполняются; text/image — комментарии', () => {
    const out = toRunnableScript(list(mixed), 'en', 'https://x/raw')
    // команды шагов присутствуют «голыми» строками
    expect(out).toContain('echo one')
    expect(out).toContain('echo two')
    // текст блока — как комментарий, не исполняемая строка
    expect(out).toContain('# Some **note**')
    expect(out).toMatch(/#.*a shot/)
    // нумерация только по шагам: 1. First и 2. Second (не 4.)
    expect(out).toContain('1. First')
    expect(out).toContain('2. Second')
    expect(out).not.toContain('4. Second')
  })

  it('toMarkdown: text инлайн, image → подпись, нумерация только по шагам', () => {
    const md = toMarkdown(list(mixed), 'en')
    expect(md).toContain('1. **First**')
    expect(md).toContain('2. **Second**')
    expect(md).toContain('Some **note**')
    expect(md).toContain('🖼 a shot')
  })

  it('step-only список нумеруется как раньше (byte-compat)', () => {
    const md = toMarkdown(list([step({ n: 1, title: { en: 'A' } }), step({ n: 2, title: { en: 'B' } })]), 'en')
    expect(md).toContain('1. **A**')
    expect(md).toContain('2. **B**')
  })
})

// Регрессия карточки export/001: команду пишет автор, и она не имеет права
// закрыть ограждение и превратить остаток документа в размеченный текст.
describe('Markdown-экспорт: команда остаётся кодом', () => {
  const payload = 'echo ok\n```\n<img src=x onerror=alert(1)>'

  it('вставленное ограждение не закрывает блок кода', () => {
    const md = toMarkdown(list([step({ command: payload })]), 'en')
    const lines = md.split('\n')
    const open = lines.findIndex((l) => /^\s*`{3,}$/.test(l))
    const fence = lines[open].trim()
    // Следующая строка-ограждение той же длины — это ЗАКРЫВАЮЩАЯ; между ней и
    // открывающей обязана лежать вся полезная нагрузка, включая её три кавычки.
    const close = lines.findIndex((l, i) => i > open && l.trim().length >= fence.length && /^`+$/.test(l.trim()))
    expect(close).toBeGreaterThan(open) // блок вообще закрыт — иначе проверка ниже бессмысленна
    const inside = lines.slice(open + 1, close)
    expect(inside.some((l) => l.includes('<img src=x onerror=alert(1)>'))).toBe(true)
    expect(inside.some((l) => l.trim() === '```')).toBe(true)
  })

  it('многострочная команда целиком лежит в отступе пункта', () => {
    const md = toMarkdown(list([step({ command: 'cd /tmp\nmake all' })]), 'en')
    expect(md).toContain('   cd /tmp')
    expect(md).toContain('   make all')
  })
})

// Отступ продолжения пункта считается по маркеру: у «10.» он длиннее, и трёх
// пробелов уже не хватает — по CommonMark содержимое выпадает из пункта.
describe('Markdown-экспорт: пункты от десятого', () => {
  it('десятый пункт держит своё содержимое', () => {
    const steps = Array.from({ length: 10 }, (_, i) => step({ n: i + 1, title: { en: `S${i + 1}` }, command: 'make all' }))
    const md = toMarkdown(list(steps), 'en')
    const lines = md.split('\n')
    const head = lines.findIndex((l) => l.startsWith('10. '))
    // Всё, что принадлежит пункту, отступлено на длину маркера «10. » = 4.
    const body = lines.slice(head + 1).filter((l) => l.trim())
    expect(body[0].startsWith('    ')).toBe(true)
  })
})
