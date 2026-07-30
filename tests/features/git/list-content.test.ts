import { describe, expect, it } from 'vitest'
import type { ListBlock, ListContent } from '@/core'
import { toCanonJson, toWireContent } from '@/features/git/list-content'

// Эти два пути записи («Применить правку» и ручной резолв конфликта) до Ф0a.2 не
// покрывались тестами вообще: сборка канона сидела внутри серверного экшена и
// требовала БД с транспортом. Маппинг вынесен отдельно именно чтобы его можно
// было проверить — регрессия здесь означает порчу формата в git.

const block = (over: Partial<ListBlock> = {}): ListBlock => ({
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

const content = (over: Partial<ListContent> = {}): ListContent => ({
  title: 'Redis Caching',
  desc: 'Set up caching',
  tags: ['redis'],
  ordered: true,
  version: 3,
  steps: [block()],
  ...over,
})

describe('toWireContent — домен → провод', () => {
  it('у шага пустые type/contentJson/blockId: proto3 не различает "" и отсутствие', () => {
    const [s] = toWireContent(content()).steps
    expect(s.type).toBe('')
    expect(s.contentJson).toBe('')
    expect(s.blockId).toBe('')
  })

  it('не-step блок несёт type и сериализованный content', () => {
    const wire = toWireContent(content({ steps: [block({ type: 'text', content: { md: 'Вступление' } })] }))
    expect(wire.steps[0].type).toBe('text')
    expect(JSON.parse(wire.steps[0].contentJson)).toEqual({ md: 'Вступление' })
  })

  it('пустой объект content — это "нет content", а не строка "{}"', () => {
    expect(toWireContent(content({ steps: [block({ type: 'text', content: {} })] })).steps[0].contentJson).toBe('')
  })

  it('ссылка без url отдаётся пустой строкой, а не undefined', () => {
    const wire = toWireContent(content({ steps: [block({ refs: [{ label: 'без ссылки' }] })] }))
    expect(wire.steps[0].refs).toEqual([{ label: 'без ссылки', url: '' }])
  })

  it('blockId=null (из трёхстороннего merge) не превращается в "null"', () => {
    expect(toWireContent(content({ steps: [block({ blockId: null })] })).steps[0].blockId).toBe('')
  })

  it('мета и порядок блоков переносятся без потерь', () => {
    const wire = toWireContent(content({ steps: [block({ n: 1 }), block({ n: 2, title: 'Configure' })] }))
    expect(wire).toMatchObject({ title: 'Redis Caching', tags: ['redis'], ordered: true, version: 3 })
    expect(wire.steps.map((s) => [s.n, s.title])).toEqual([
      [1, 'Install Redis'],
      [2, 'Configure'],
    ])
  })
})

describe('toCanonJson — домен → канонический list.json (inproc-путь)', () => {
  it('необязательные поля пишутся только когда есть: иначе плывут байты', () => {
    const json = toCanonJson(content())
    expect(json).not.toContain('"blockId"')
    expect(json).not.toContain('"type"')
    expect(json).not.toContain('"content"')
  })

  it('blockId попадает в канон, когда он задан', () => {
    const json = toCanonJson(content({ steps: [block({ blockId: 'b-1' })] }))
    expect(JSON.parse(json).steps[0].blockId).toBe('b-1')
  })

  it('type="step" считается шагом и в канон не пишется', () => {
    expect(toCanonJson(content({ steps: [block({ type: 'step' })] }))).not.toContain('"type"')
  })

  it('не-step блок несёт type и content', () => {
    const parsed = JSON.parse(toCanonJson(content({ steps: [block({ type: 'image', content: { ref: 'k' } })] })))
    expect(parsed.steps[0]).toMatchObject({ type: 'image', content: { ref: 'k' } })
  })

  it('мета версии на месте и файл заканчивается переводом строки', () => {
    const json = toCanonJson(content())
    expect(JSON.parse(json)).toMatchObject({ title: 'Redis Caching', ordered: true, version: 3 })
    expect(json.endsWith('\n')).toBe(true)
  })
})

describe('обе формы описывают одно и то же', () => {
  it('провод и канон не расходятся по составу блоков', () => {
    const c = content({
      steps: [block({ n: 1, blockId: 'b-1' }), block({ n: 2, type: 'text', content: { md: 'x' } })],
    })
    const wire = toWireContent(c)
    const canon = JSON.parse(toCanonJson(c))
    expect(wire.steps.length).toBe(canon.steps.length)
    expect(wire.steps.map((s) => s.n)).toEqual(canon.steps.map((s: { n: number }) => s.n))
    // Идентичность и тип блока должны выжить в ОБЕИХ формах — иначе remote и
    // inproc записали бы в git разное.
    expect(wire.steps[0].blockId).toBe('b-1')
    expect(canon.steps[0].blockId).toBe('b-1')
    expect(wire.steps[1].type).toBe('text')
    expect(canon.steps[1].type).toBe('text')
  })
})
