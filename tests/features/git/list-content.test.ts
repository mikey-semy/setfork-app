import { describe, expect, it } from 'vitest'
import type { ListBlock, ListContent } from '@/core'
import { fromWireContent, fromWireStep, toWireContent, type WireStep } from '@/features/git/list-content'
import { snapshotSteps } from '@/features/git/snapshot-steps'

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

describe('fromWireStep — провод → домен (общий для снимка ветки и строгого разбора)', () => {
  const wire = (over: Partial<WireStep> = {}): WireStep => ({
    n: 1,
    type: '',
    contentJson: '',
    blockId: '',
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

  it('довески канона переживают провод: без них сохранение стёрло бы картинку и пометку', () => {
    // Набор шагов при сохранении перезаписывается ЦЕЛИКОМ, поэтому поле, о котором
    // путь не знает, исчезает молча — этот баг в проекте чинили дважды.
    const s = fromWireStep(wire({ imageKey: 'u/1/shot.png', needsHuman: true, needsHumanAsk: 'глянь', danger: true }))
    expect(s.imageKey).toBe('u/1/shot.png')
    expect(s.needsHuman).toBe(true)
    expect(s.needsHumanAsk).toBe('глянь')
    expect(s.danger).toBe(true)
  })

  it('пустые пометки в домен не протекают: пусто на проводе = «нет»', () => {
    const s = fromWireStep(wire())
    expect(s.imageKey).toBeUndefined()
    expect(s.needsHuman).toBeUndefined()
    expect(s.needsHumanAsk).toBeUndefined()
    expect(s.danger).toBe(false)
  })

  it('шаг остаётся шагом, блок несёт type и разобранный content', () => {
    expect(fromWireStep(wire({ type: 'step' })).type).toBeUndefined()
    const b = fromWireStep(wire({ type: 'text', contentJson: '{"md":"x"}' }))
    expect(b.type).toBe('text')
    expect(b.content).toEqual({ md: 'x' })
  })

  it('битый content от чужого клиента не роняет чтение', () => {
    expect(fromWireStep(wire({ type: 'text', contentJson: 'не json' })).content).toEqual({})
  })

  it('ссылка без адреса не получает пустой url, идентичности нет → null', () => {
    const s = fromWireStep(wire({ refs: [{ label: 'docs', url: '' }] }))
    expect(s.refs).toEqual([{ label: 'docs' }])
    expect(s.blockId).toBeNull()
  })
})

describe('круг домен → провод → домен', () => {
  it('содержимое возвращается тем же (кроме пометок, которые записью не едут)', () => {
    const c = content({ steps: [block({ n: 1, blockId: 'b-1' }), block({ n: 2, type: 'text', content: { md: 'x' } })] })
    const back = fromWireContent(toWireContent(c))
    expect(back).toMatchObject({ title: c.title, desc: c.desc, tags: c.tags, ordered: true, version: 3 })
    expect(back.steps.map((s) => [s.n, s.title, s.blockId])).toEqual([
      [1, 'Install Redis', 'b-1'],
      [2, 'Install Redis', null],
    ])
    expect(back.steps[1].content).toEqual({ md: 'x' })
  })
})

describe('снимок ветки перестал врать про картинку и пометку', () => {
  it('ключ картинки и «нужен человек» доезжают до строк, а не гасятся в null/false', () => {
    // До Ф2a канон этих полей не нёс, и здесь стояло жёсткое false с пояснением
    // «в git не сериализуется». Поля появились, пояснение устарело — а дифф правки
    // из-за него показывал пункт без пометки и без скриншота.
    const snap = {
      tipSha: 'abc',
      title: 'T',
      desc: '',
      tags: [],
      ordered: true,
      steps: [fromWireStep({
        n: 1, type: '', contentJson: '', blockId: '', title: 'Ш', desc: '', command: '', level: 'required',
        why: '', section: '', subtasks: [], refs: [],
        imageKey: 'u/1/shot.png', needsHuman: true, needsHumanAsk: 'глянь глазами',
      })],
    }
    const [row] = snapshotSteps(snap)
    expect(row.imageKey).toBe('u/1/shot.png')
    expect(row.hasImage).toBe(true)
    expect(row.needsHuman).toBe(true)
    expect(row.needsHumanAsk).toEqual({ en: 'глянь глазами' })
  })
})
