import { describe, expect, it } from 'vitest'
import { parseList } from '@/shared/ai/generate'
import { toProposed, toStepInput } from '@/shared/lib/step-input'
import { emptyItem, toEditorItems, toProposedItems, type EditorItem } from '@/features/library/editor'

// «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК» — пометка на пункте там, где машина честно не знает: местные цены,
// вкус, время на конкретном оборудовании, региональные правила. Смысл в том, что выдумка
// вреднее скудности: пусть стоит приглашение человеку, а не правдоподобная цифра.
//
// Путь пометки длинный (модель → кандидат → снимок правки → шаг в БД → редактор → снова
// снимок), и на каждом стыке она может тихо выпасть — именно так однажды терялся `section`.
// Тесты держат весь путь.

const listJson = (item: Record<string, unknown>) =>
  JSON.stringify({ title: 'Хлеб', desc: 'd', tags: ['еда'], hint: '', items: [{ title: 'Замесить', desc: '', command: '', section: '', level: 'required', why: '', subtasks: [], refs: [], ...item }] })

describe('разбор ответа модели', () => {
  it('пометка и вопрос доезжают', () => {
    const got = parseList(listJson({ needsHuman: true, needsHumanAsk: 'Сколько стоит мука у вас?' }), 'x')
    expect(got?.items[0]).toMatchObject({ needsHuman: true, needsHumanAsk: 'Сколько стоит мука у вас?' })
  })

  it('без пометки — false и пустой вопрос (не undefined-мусор в БД)', () => {
    const got = parseList(listJson({}), 'x')
    expect(got?.items[0]).toMatchObject({ needsHuman: false, needsHumanAsk: '' })
  })

  it('нестрогая правда не считается пометкой: "true", 1, null', () => {
    for (const v of ['true', 1, null, {}]) {
      expect(parseList(listJson({ needsHuman: v }), 'x')?.items[0].needsHuman).toBe(false)
    }
  })

  it('длинный вопрос режется — это подпись под пунктом, не эссе', () => {
    const got = parseList(listJson({ needsHuman: true, needsHumanAsk: 'я'.repeat(400) }), 'x')
    expect(got?.items[0].needsHumanAsk?.length).toBe(160)
  })
})

describe('конвертеры на запись', () => {
  const item = (over: Record<string, unknown> = {}) => ({ title: 'Замесить', desc: '', command: '', level: 'required' as const, why: '', subtasks: [], refs: [], ...over })

  it('помеченный пункт: вопрос уезжает в LocaleText языка списка', () => {
    const [p] = toProposed([item({ needsHuman: true, needsHumanAsk: 'Сколько стоит?' })], 'ru')
    expect(p).toMatchObject({ needsHuman: true, needsHumanAsk: { ru: 'Сколько стоит?' } })
  })

  it('непомеченный пункт полей не получает вовсе — снимок правки не пухнет', () => {
    const [p] = toProposed([item()], 'ru')
    expect('needsHuman' in p).toBe(false)
  })

  it('пометка без вопроса допустима: общий текст приглашения даст UI', () => {
    const [p] = toProposed([item({ needsHuman: true })], 'ru')
    expect(p).toMatchObject({ needsHuman: true, needsHumanAsk: {} })
  })

  it('в шаги для БД доезжает с явным false у непомеченных', () => {
    const steps = toStepInput(toProposed([item({ needsHuman: true, needsHumanAsk: 'q' }), item()], 'ru'))
    expect(steps[0]).toMatchObject({ needsHuman: true, needsHumanAsk: { ru: 'q' } })
    expect(steps[1]).toMatchObject({ needsHuman: false, needsHumanAsk: {} })
  })
})

describe('редактор: человек отвечает и снимает пометку', () => {
  const step = (over: Partial<EditorItem> = {}): EditorItem => ({ ...emptyItem(), ...over })

  it('круг: редактор → снимок → редактор сохраняет пометку и вопрос', () => {
    const proposed = toProposedItems([step({ title: 'Замесить', needsHuman: true, needsHumanAsk: 'Цена муки?' })], 'ru')
    expect(proposed[0]).toMatchObject({ needsHuman: true, needsHumanAsk: { ru: 'Цена муки?' } })
    const back = toEditorItems(proposed, 'ru')
    expect(back[0]).toMatchObject({ needsHuman: true, needsHumanAsk: 'Цена муки?' })
  })

  it('снятая галочка гасит и вопрос — ответил человек, приглашение больше не висит', () => {
    const proposed = toProposedItems([step({ title: 'Замесить', needsHuman: false, needsHumanAsk: 'осталось с прошлого раза' })], 'ru')
    expect(proposed[0]).toMatchObject({ needsHuman: false, needsHumanAsk: {} })
  })

  it('старые данные без пометки читаются как непомеченные', () => {
    const back = toEditorItems([{ title: { ru: 'Старый' }, desc: {}, command: '', hasImage: false, subtasks: [], refs: [] }], 'ru')
    expect(back[0]).toMatchObject({ needsHuman: false, needsHumanAsk: '' })
  })
})
