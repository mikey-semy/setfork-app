import { describe, expect, it } from 'vitest'
import { GARDENER_BASE_INSTRUCTION, dominantLang, inferListKind, policyFor, policySettingKey } from '@/shared/ai/gardener-policies'
import { parseList } from '@/shared/ai/generate'

describe('policyFor', () => {
  it('база + политика типа; у рецепта — «~» и запрет выдумывать', () => {
    const p = policyFor('recipe')
    expect(p).toContain(GARDENER_BASE_INSTRUCTION)
    expect(p).toContain('RECIPE POLICY')
    expect(p).toContain('"~"')
    expect(p).toContain('NEVER invent amounts')
  })

  it('админ-override заменяет код-дефолт политики, база остаётся', () => {
    const p = policyFor('procedure', { procedure: 'CUSTOM: только проверка ссылок' })
    expect(p).toContain(GARDENER_BASE_INSTRUCTION)
    expect(p).toContain('CUSTOM: только проверка ссылок')
    expect(p).not.toContain('PROCEDURE POLICY')
  })

  it('пустой override игнорируется (фолбэк на код)', () => {
    expect(policyFor('checklist', { checklist: '   ' })).toContain('CHECKLIST POLICY')
  })

  it('policySettingKey — стабильный формат ключа', () => {
    expect(policySettingKey('recipe')).toBe('gardener.policy.recipe')
  })
})

describe('dominantLang', () => {
  it('русский список → ru (чинит рефайн RU-списков по-английски)', () => {
    expect(dominantLang([{ ru: 'Маршмеллоу' }, { ru: 'Сахар — 400 г' }, { ru: 'Взбить' }])).toBe('ru')
  })
  it('двуязычный (перевод есть везде) → en при ничьей', () => {
    expect(dominantLang([{ en: 'A', ru: 'А' }, { en: 'B', ru: 'Б' }])).toBe('en')
  })
  it('пустые/undefined значения не считаются', () => {
    expect(dominantLang([{ en: '', ru: 'Только рус' }, undefined, null])).toBe('ru')
  })
})

describe('inferListKind', () => {
  it('секция «Ингредиенты» → recipe (независимо от заголовка)', () => {
    expect(inferListKind({ title: 'Домашний зефир', sections: ['Ингредиенты', 'Приготовление'], commandCount: 0 })).toBe('recipe')
    expect(inferListKind({ title: 'Marshmallow', sections: ['Ingredients'], commandCount: 0 })).toBe('recipe')
  })
  it('≥2 команд → procedure', () => {
    expect(inferListKind({ title: 'Что-то', sections: [], commandCount: 2 })).toBe('procedure')
  })
  it('без структурных сигналов — грамматика заголовка', () => {
    expect(inferListKind({ title: 'Что взять в поход', sections: [], commandCount: 0 })).toBe('inventory')
    expect(inferListKind({ title: 'Deploy to production', sections: [], commandCount: 0 })).toBe('procedure')
  })
})

describe('parseList сохраняет section (раньше терялся)', () => {
  it('раунд-трип рецепта: секции на месте, обрезка до 80', () => {
    const json = JSON.stringify({
      title: 'Зефир',
      desc: '',
      tags: ['десерт'],
      items: [
        { title: 'Сахар — 400 г', desc: '', command: '', section: ' Ингредиенты ', level: 'required', why: '', subtasks: [], refs: [] },
        { title: 'Взбить массу', desc: '', command: '', section: 'Приготовление', level: 'required', why: '', subtasks: [], refs: [] },
        { title: 'Без секции', desc: '', command: '', level: 'required', why: '', subtasks: [], refs: [] },
        { title: 'Длинная', desc: '', command: '', section: 'x'.repeat(200), level: 'required', why: '', subtasks: [], refs: [] },
      ],
    })
    const parsed = parseList(json, 'fb')!
    expect(parsed.items.map((i) => i.section)).toEqual(['Ингредиенты', 'Приготовление', '', 'x'.repeat(80)])
  })
})
