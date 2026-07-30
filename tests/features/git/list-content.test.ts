import { describe, expect, it } from 'vitest'
import type { ListBlock, ListContent } from '@/core'
import { toWireContent } from '@/features/git/list-content'

// Эти два пути записи («Применить правку» и ручной резолв конфликта) до Ф0a.2 не
// покрывались тестами вообще: сборка канона сидела внутри серверного экшена и
// требовала БД с транспортом. Теперь канон собирает ядро, а здесь проверяется
// единственное, что осталось на фронте, — что содержимое доезжает до него без
// потерь. Регрессия тут означает порчу формата в git.

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

describe('состав блоков доезжает целиком', () => {
  it('номера, идентичность и типы не теряются', () => {
    const c = content({
      steps: [block({ n: 1, blockId: 'b-1' }), block({ n: 2, type: 'text', content: { md: 'x' } })],
    })
    const wire = toWireContent(c)
    expect(wire.steps.map((s) => s.n)).toEqual([1, 2])
    // Идентичность и тип блока обязаны доехать до ядра: по ним оно решает, что
    // писать в list.json, и без них дифф ветки читает переименование как
    // «удалён + добавлен».
    expect(wire.steps[0].blockId).toBe('b-1')
    expect(wire.steps[1].type).toBe('text')
  })
})
