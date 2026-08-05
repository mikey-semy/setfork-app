import { describe, expect, it } from 'vitest'
import { buildScript, toRunnableScript, type ExportList, type ExportStep } from '@/features/library/export'

/**
 * ИСПОЛНИМОСТЬ НА УРОВНЕ ПУНКТА: справочник на тридцать пунктов не должен
 * приезжать одним скриптом, когда нужен один пункт. Плюс обязательное условие —
 * разрушительная команда не попадает в собранный скрипт исполняемой.
 */
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
  title: { en: 'Server maintenance' },
  desc: {},
  tags: [],
  ordered: true,
  version: 3,
  ownerHandle: 'mike',
  slug: 'srv',
  steps,
})

const reference = list([
  step({ n: 1, bid: 'b-1', title: { en: 'Check disk' }, command: 'df -h' }),
  step({ n: 2, bid: 'b-2', title: { en: 'Show logs' }, command: 'journalctl -u app -n 100' }),
  step({ n: 3, bid: 'b-3', title: { en: 'Free volumes' }, command: 'docker system prune -a --volumes' }),
  step({ n: 4, bid: 'b-4', title: { en: 'Restart' }, command: 'systemctl restart app', subtasks: [{ en: 'service answers 200' }] }),
])

describe('скрипт из выбранных пунктов', () => {
  it('без адресов — весь список, как раньше', () => {
    const { included } = buildScript(reference, 'en', 'https://x/raw')
    expect(included.map((s) => s.bid)).toEqual(['b-1', 'b-2', 'b-4'])
  })

  it('один адрес — скрипт из одной команды с обвязкой', () => {
    const out = toRunnableScript(reference, 'en', 'https://x/raw', 'sh', { only: ['b-2'] })
    expect(out).toContain('journalctl -u app -n 100')
    expect(out).not.toContain('df -h')
    expect(out).toContain('#!/usr/bin/env bash')
    expect(out).toContain('set -euo pipefail')
    expect(out).toContain('Selected steps only: 1 of 4 blocks')
  })

  it('несколько адресов — порядок СПИСКА, а не порядок запроса', () => {
    const out = toRunnableScript(reference, 'en', 'https://x/raw', 'sh', { only: ['b-4', 'b-1'] })
    expect(out.indexOf('df -h')).toBeLessThan(out.indexOf('systemctl restart app'))
    // Нумерация — по выборке: человек видит «1, 2», а не дыры от невыбранных пунктов.
    expect(out).toContain('1. Check disk')
    expect(out).toContain('2. Restart')
  })

  it('подпункты идут ПОСЛЕ команды как проверки, а не вместо неё', () => {
    const out = toRunnableScript(reference, 'en', 'https://x/raw', 'sh', { only: ['b-4'] })
    expect(out.indexOf('systemctl restart app')).toBeLessThan(out.indexOf('service answers 200'))
  })
})

describe('разрушительный пункт', () => {
  it('по шаблону команды — закомментирован, даже без пометки автора', () => {
    const { script, included, skipped } = buildScript(reference, 'en', 'https://x/raw')
    expect(script).toContain('# docker system prune -a --volumes')
    // Голой строкой команда не встречается ни разу: перед ней всегда решётка.
    expect(script).not.toMatch(/^docker system prune/m)
    expect(script).toContain('skipped (destructive)')
    expect(included.map((s) => s.bid)).not.toContain('b-3')
    expect(skipped).toEqual([{ n: 3, bid: 'b-3', reason: 'prunesVolumes' }])
  })

  it('пометка автора комментирует и безобидную на вид команду', () => {
    const marked = list([step({ n: 1, bid: 'b-1', title: { en: 'Wipe cache' }, command: './cleanup.sh', danger: true })])
    const { script, skipped } = buildScript(marked, 'en', 'https://x/raw')
    expect(script).toContain('# ./cleanup.sh')
    expect(skipped).toEqual([{ n: 1, bid: 'b-1', reason: 'danger' }])
  })

  it('многострочная команда комментируется ЦЕЛИКОМ, а не первой строкой', () => {
    const multi = list([
      step({ n: 1, bid: 'b-1', title: { en: 'Reset' }, command: 'echo before\nterraform destroy -auto-approve\necho after' }),
    ])
    const { script } = buildScript(multi, 'en', 'https://x/raw')
    for (const line of ['echo before', 'terraform destroy -auto-approve', 'echo after']) {
      expect(script).toContain(`# ${line}`)
      expect(script).not.toMatch(new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
    }
  })

  it('в ps1 и py комментарий тоже комментарий', () => {
    for (const dialect of ['ps1', 'py'] as const) {
      const out = toRunnableScript(reference, 'en', 'https://x/raw', dialect, { only: ['b-3'] })
      expect(out).toContain('# docker system prune -a --volumes')
      expect(out).not.toMatch(/^docker system prune/m)
    }
  })

  it('обычные команды остаются исполняемыми', () => {
    const { script } = buildScript(reference, 'en', 'https://x/raw')
    expect(script).toMatch(/^df -h$/m)
    expect(script).toMatch(/^systemctl restart app$/m)
  })
})
