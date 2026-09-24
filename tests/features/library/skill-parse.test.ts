import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExportList, ExportStep } from '@/features/library/export'
import { toSkillMarkdown } from '@/features/library/skill'
import { parseSkillMd } from '@/features/library/skill-parse'

/**
 * РАЗБОР `SKILL.md` В БЛОКИ — обратная к экспорту («блоки — правда», решение 24.09.2026).
 *
 * Два свойства, и оба ломаются молча:
 *  1) КРУГ: экспорт → разбор возвращает те же шаги со всеми полями. Потерянное поле здесь
 *     — это поле, которое пропадёт у каждого, кто перенёс свой скилл на SetFork;
 *  2) ЧУЖОЙ СКИЛЛ: проза становится текстом, нумерованная процедура — шагами, а шум
 *     нашего экспорта в список не возвращается.
 */
const step = (over: Partial<ExportStep> = {}): ExportStep => ({
  n: 1,
  title: { en: 'Step' },
  desc: {},
  command: '',
  level: 'required',
  why: {},
  subtasks: [],
  refs: [],
  ...over,
})
const list = (over: Partial<ExportList> = {}): ExportList => ({
  title: { en: 'Service outage' },
  desc: { en: 'What to do when the service is down. Use when a health check fails.' },
  tags: [],
  ordered: true,
  version: 3,
  ownerHandle: 'miki',
  slug: 'service-outage',
  steps: [step()],
  ...over,
})

describe('круг экспорт → разбор', () => {
  it('шаги возвращаются со всеми полями', () => {
    const src = list({
      steps: [
        step({ n: 1, title: { en: 'Check the network' }, desc: { en: 'Ping the gateway.\n\nThen the DNS.' }, command: 'ping -c1 10.0.0.1', why: { en: 'Most outages are the network' }, section: { en: 'Diagnose' } }),
        step({ n: 2, title: { en: 'Look at the disk' }, level: 'optional', subtasks: [{ en: 'df -h is below 90%' }], refs: [{ label: { en: 'Runbook' }, url: 'https://example.org/rb' }], section: { en: 'Diagnose' } }),
        step({ n: 3, title: { en: 'Restart production' }, command: 'systemctl restart app', needsHuman: true, needsHumanAsk: { en: 'is the maintenance window open?' }, section: { en: 'Fix' } }),
        step({ n: 4, title: { en: 'Wipe the cache' }, command: 'rm -rf /var/cache/app', section: { en: 'Fix' } }),
      ],
    })
    const parsed = parseSkillMd(toSkillMarkdown(src, 'en', { origin: 'https://setfork.test' }))
    expect(parsed.name).toBe('service-outage')
    expect(parsed.description).toBe('What to do when the service is down. Use when a health check fails.')
    expect(parsed.title).toBe('Service outage')
    expect(parsed.items).toEqual([
      { type: 'step', title: 'Check the network', desc: 'Ping the gateway.\n\nThen the DNS.', command: 'ping -c1 10.0.0.1', why: 'Most outages are the network', section: 'Diagnose' },
      { type: 'step', title: 'Look at the disk', level: 'optional', subtasks: ['df -h is below 90%'], refs: [{ label: 'Runbook', url: 'https://example.org/rb' }], section: 'Diagnose' },
      { type: 'step', title: 'Restart production', command: 'systemctl restart app', needsHuman: true, needsHumanAsk: 'is the maintenance window open?', section: 'Fix' },
      { type: 'step', title: 'Wipe the cache', command: 'rm -rf /var/cache/app', danger: true, section: 'Fix' },
    ])
    // Шум экспорта — предупреждение, ссылка на архив, подпись — в список не вернулся.
    expect(JSON.stringify(parsed.items)).not.toMatch(/Review before use|Source:|skill\.tar\.gz/)
  })

  it('неупорядоченный список: шаги узнаются по жирному заголовку', () => {
    const parsed = parseSkillMd(toSkillMarkdown(list({ ordered: false, steps: [step({ title: { en: 'Pack' } }), step({ n: 2, title: { en: 'Go' } })] }), 'en', { origin: 'https://x.test' }))
    expect(parsed.items.map((b) => [b.type, b.title])).toEqual([
      ['step', 'Pack'],
      ['step', 'Go'],
    ])
  })
})

describe('чужой скилл', () => {
  const FOREIGN = [
    '---',
    'name: pdf-tools',
    'description: >-',
    '  Fill and merge PDF files. Use when the user asks to work with a PDF.',
    'license: MIT',
    'metadata:',
    '  version: "1.2.0"',
    '---',
    '',
    '# PDF tools',
    '',
    'This skill works with PDFs through **pypdf**.',
    '',
    '## Merge',
    '',
    '1. Install the library',
    '',
    '   ```bash',
    '   pip install pypdf',
    '   ```',
    '2. **Run the merge.** It keeps bookmarks.',
    '',
    '- a note, not a step',
    '- another note',
    '',
    '```python',
    '# 1. not a step: inside code',
    '```',
  ].join('\n')

  it('шапка целиком, проза — текстом, нумерованное — шагами', () => {
    const p = parseSkillMd(FOREIGN)
    expect(p.name).toBe('pdf-tools')
    expect(p.description).toBe('Fill and merge PDF files. Use when the user asks to work with a PDF.')
    expect(p.header).toEqual({ license: 'MIT', metadata: { version: '1.2.0' } })
    expect(p.title).toBe('PDF tools')
    expect(p.items).toEqual([
      { type: 'text', text: 'This skill works with PDFs through **pypdf**.' },
      { type: 'step', title: 'Install the library', command: 'pip install pypdf', section: 'Merge' },
      { type: 'step', title: 'Run the merge', desc: 'It keeps bookmarks.', section: 'Merge' },
      { type: 'text', text: '- a note, not a step\n- another note\n\n```python\n# 1. not a step: inside code\n```', section: 'Merge' },
    ])
    expect(p.warnings).toEqual([])
  })

  it('без шапки и описания — предупреждения, а не молчание', () => {
    const p = parseSkillMd('# Just text\n\nHello.')
    expect(p.title).toBe('Just text')
    expect(p.warnings.join(' ')).toMatch(/no frontmatter/)
    expect(p.warnings.join(' ')).toMatch(/no description/)
  })

  it('битая шапка — предупреждение, тело всё равно разобрано', () => {
    const p = parseSkillMd('---\nname: [oops\n---\n# T\n\n1. Do')
    expect(p.warnings.join(' ')).toMatch(/not valid YAML/)
    expect(p.items).toEqual([{ type: 'step', title: 'Do' }])
  })

  it('настоящий скилл finetooth разбирается без потерь по составу', () => {
    let md = ''
    try {
      md = readFileSync(`${process.env.HOME}/Projects/finetooth/skills/finetooth/SKILL.md`, 'utf8')
    } catch {
      return // нет клона рядом — проверка только на машине владельца
    }
    const p = parseSkillMd(md)
    expect(p.name).toBe('finetooth')
    expect(p.items.length).toBeGreaterThan(5)
    // Каждое слово тела попало в какой-то блок: проверяем по заголовкам разделов.
    for (const h of md.match(/^## .+$/gm) ?? []) expect(p.items.some((b) => b.section === h.slice(3))).toBe(true)
  })
})
