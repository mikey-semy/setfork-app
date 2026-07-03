import { describe, expect, it } from 'vitest'
import { versionFiles, type SerStep, type SerVersion } from './serialize'

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
