import { describe, expect, it } from 'vitest'
import { parseList, versionFiles, type SerStep, type SerVersion } from './serialize'

const step = (over: Partial<SerStep> = {}): SerStep => ({
  n: 1,
  title: 'Install Redis',
  desc: '',
  command: '',
  level: 'required',
  why: '',
  section: '',
  subtasks: [],
  refs: [],
  ...over,
})

const version = (over: Partial<SerVersion> = {}): SerVersion => ({
  title: 'Redis Caching',
  desc: 'Set up caching',
  tags: ['redis', 'caching'],
  ordered: true,
  version: 3,
  steps: [step()],
  ...over,
})

describe('versionFiles — golden serialization (must match Rust git-core)', () => {
  it('always emits README.md then list.json then one file per step', () => {
    const files = versionFiles(version({ steps: [step({ n: 1 }), step({ n: 2, title: 'Configure' })] }))
    expect(files.map((f) => f.path)).toEqual(['README.md', 'list.json', 'steps/01-install-redis.md', 'steps/02-configure.md'])
  })

  it('list.json = pretty JSON with fixed key order + trailing newline', () => {
    const v = version()
    const listJson = versionFiles(v).find((f) => f.path === 'list.json')!.content
    // порядок ключей строго title/desc/tags/ordered/version/steps (важно для SHA-идентичности)
    expect(listJson).toBe(JSON.stringify({ title: v.title, desc: v.desc, tags: v.tags, ordered: v.ordered, version: v.version, steps: v.steps }, null, 2) + '\n')
    expect(listJson.startsWith('{\n  "title": "Redis Caching",')).toBe(true)
    expect(listJson.endsWith('\n')).toBe(true)
  })

  it('README carries title, tags and ordered marker', () => {
    const readme = versionFiles(version()).find((f) => f.path === 'README.md')!.content
    expect(readme).toContain('# Redis Caching')
    expect(readme).toContain('`redis` `caching`')
    expect(readme).toContain('> Ordered list · v3 · 1 items')
    expect(readme.endsWith('\n')).toBe(true)
  })

  it('step number padding widens with step count', () => {
    const one = versionFiles(version({ steps: [step({ n: 7 })] }))
    expect(one.some((f) => f.path === 'steps/07-install-redis.md')).toBe(true)
    const many = versionFiles(version({ steps: Array.from({ length: 12 }, (_, i) => step({ n: i + 1, title: `Step ${i + 1}` })) }))
    expect(many.some((f) => f.path === 'steps/01-step-1.md')).toBe(true)
    const hundred = versionFiles(version({ steps: Array.from({ length: 100 }, (_, i) => step({ n: i + 1, title: `Step ${i + 1}` })) }))
    expect(hundred.some((f) => f.path === 'steps/001-step-1.md')).toBe(true)
  })

  it('slugify: cyrillic kept, symbols collapse to -, empty falls back to "step", capped at 40', () => {
    const slug = (title: string) => versionFiles(version({ steps: [step({ n: 1, title })] })).find((f) => f.path.startsWith('steps/'))!.path
    expect(slug('Установка Redis!!!')).toBe('steps/01-установка-redis.md')
    expect(slug('@#$%^&*()')).toBe('steps/01-step.md')
    expect(slug('a'.repeat(60))).toBe(`steps/01-${'a'.repeat(40)}.md`)
  })

  it('step front-matter includes level and JSON-escaped title/section/command', () => {
    const f = versionFiles(version({ steps: [step({ n: 1, title: 'Say "hi"', level: 'optional', section: 'Setup', command: 'echo "x"' })] }))
    const md = f.find((x) => x.path.startsWith('steps/'))!.content
    expect(md).toContain('title: "Say \\"hi\\""')
    expect(md).toContain('level: optional')
    expect(md).toContain('section: "Setup"')
    expect(md).toContain('command: "echo \\"x\\""')
  })
})

describe('block model — byte-compat for step-only + non-step blocks', () => {
  // Инвариант golden: список из одних шагов (без type/content) должен давать
  // ТОТ ЖЕ выхлоп, что и до введения блоков — иначе ломается SHA-совместимость с Rust.
  it('step-only list: type/content omitted from list.json (no diff-noise)', () => {
    const listJson = versionFiles(version()).find((f) => f.path === 'list.json')!.content
    expect(listJson).not.toContain('"type"')
    expect(listJson).not.toContain('"content"')
  })

  it('explicit type:"step" serializes identically to undefined type', () => {
    const withType = versionFiles(version({ steps: [step({ n: 1, type: 'step' })] }))
    const without = versionFiles(version({ steps: [step({ n: 1 })] }))
    // NB: type:'step' попадает в list.json, но НЕ должен ломать README/шаги.
    expect(withType.find((f) => f.path === 'README.md')!.content).toBe(without.find((f) => f.path === 'README.md')!.content)
    expect(withType.map((f) => f.path)).toEqual(without.map((f) => f.path))
  })

  it('non-step blocks get NO steps/*.md and render inline in README', () => {
    const v = version({
      ordered: true,
      steps: [
        step({ n: 1, title: 'First' }),
        { n: 2, type: 'text', content: { md: 'Some **intro** copy.' }, title: '', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
        { n: 3, type: 'image', content: { ref: 'img/abc', caption: 'Diagram' }, title: '', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
        step({ n: 4, title: 'Second' }),
      ],
    })
    const files = versionFiles(v)
    // только 2 шаг-блока дают .md
    expect(files.filter((f) => f.path.startsWith('steps/')).map((f) => f.path)).toEqual(['steps/01-first.md', 'steps/04-second.md'])
    const readme = files.find((f) => f.path === 'README.md')!.content
    expect(readme).toContain('Some **intro** copy.')
    expect(readme).toContain('![Diagram](img/abc)')
    // нумерация и счётчик — только по шагам (2 шага, помечены 1. и 2.)
    expect(readme).toContain('· 2 items')
    expect(readme).toContain('1. **First**')
    expect(readme).toContain('2. **Second**')
  })

  it('parseList round-trips list.json back to the same SerVersion (with blocks)', () => {
    const v = version({
      steps: [
        step({ n: 1, title: 'First', desc: 'do it', command: 'echo hi', subtasks: ['a'], refs: [{ label: 'docs', url: 'https://x' }] }),
        { n: 2, type: 'text', content: { md: 'note' }, title: '', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
      ],
    })
    const listJson = versionFiles(v).find((f) => f.path === 'list.json')!.content
    expect(parseList(listJson)).toEqual(v)
  })

  it('parseList tolerates garbage', () => {
    expect(parseList('not json')).toBeNull()
    expect(parseList('{}')).toBeNull()
    expect(parseList('[]')).toBeNull()
  })
})
