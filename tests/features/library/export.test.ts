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
