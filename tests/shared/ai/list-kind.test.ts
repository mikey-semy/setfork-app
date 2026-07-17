import { describe, it, expect } from 'vitest'
import { classifyListKind, backfillRecipeSections, LIST_KINDS, type ListKind } from '@/shared/ai/list-kind'

/**
 * Eval-набор классификатора типа списка (ADR-0010). Принцип: evals — source of truth, по которому
 * меряем классификатор, а не «на глаз». Растёт из ДВУХ источников: реальные запросы + метка list_kind
 * из БД (клик пользователя по переключателю = верная метка) и ручные крайние случаи, где грамматика
 * промахивалась (кириллица-\b, «суп»→рецепт, потерянный токен «vs»). Гейт в CI: `npm test`.
 */
const CASES: { q: string; kind: ListKind }[] = [
  // recipe — ингредиенты + готовка (не чистая процедура)
  { q: 'Рецепт маршмеллоу', kind: 'recipe' },
  { q: 'Гороховый суп', kind: 'recipe' }, // «суп» — рецепт, не процедура
  { q: 'Как испечь наполеон', kind: 'recipe' },
  { q: 'Борщ классический', kind: 'recipe' },
  { q: 'How to bake sourdough bread', kind: 'recipe' },
  { q: 'Салат цезарь', kind: 'recipe' },
  // inventory — список вещей (провал VR был здесь)
  { q: 'Конкретные аксессуары к VR-шлему: чехлы, сумка, аккумуляторы', kind: 'inventory' },
  { q: 'VR-шлем и аксессуары к нему', kind: 'inventory' },
  { q: 'Что взять в поход в горы', kind: 'inventory' },
  { q: 'Что нужно для новорождённого', kind: 'inventory' },
  { q: 'Снаряжение для сноуборда', kind: 'inventory' },
  { q: 'What to pack for a beach trip', kind: 'inventory' },
  { q: 'Комплект для домашнего офиса', kind: 'inventory' },
  // checklist — состояния для проверки
  { q: 'Что проверить перед деплоем', kind: 'checklist' },
  { q: 'Не забыть перед выездом на дачу', kind: 'checklist' },
  { q: 'Checklist before launching a startup', kind: 'checklist' },
  // criteria — правила выбора
  { q: 'Как выбрать VR-шлем', kind: 'criteria' },
  { q: 'На что смотреть при покупке б/у авто', kind: 'criteria' },
  { q: 'Критерии выбора ноутбука для разработки', kind: 'criteria' },
  { q: 'How to choose a mattress', kind: 'criteria' },
  // options — сравнение вариантов
  { q: 'Quest 3 или Pico 4 что лучше', kind: 'options' },
  { q: 'Лучшие фреймворки для бэкенда', kind: 'options' },
  { q: 'React vs Vue что выбрать', kind: 'options' }, // токен «vs» терялся при cyrillic-\b рефакторе
  { q: 'Топ 5 VPN для России', kind: 'options' },
  // procedure — дефолт, пошаговое действие
  { q: 'Настроить CI для монорепозитория на GitHub Actions', kind: 'procedure' },
  { q: 'Настроить nginx как reverse proxy', kind: 'procedure' },
  { q: 'Убраться в квартире', kind: 'procedure' },
  { q: 'Развернуть Postgres в Docker', kind: 'procedure' },
  { q: 'Подготовиться к собеседованию', kind: 'procedure' },
  { q: 'Deploy a Next.js app to Vercel', kind: 'procedure' },
]

describe('classifyListKind', () => {
  // Каждый кейс — отдельный тест: провал показывает КОНКРЕТНЫЙ запрос, а не «упало N штук».
  for (const c of CASES) {
    it(`[${c.kind}] ${c.q}`, () => {
      expect(classifyListKind(c.q)).toBe(c.kind)
    })
  }

  it('overall accuracy ≥ 90% (регресс-гейт классификатора)', () => {
    const correct = CASES.filter((c) => classifyListKind(c.q) === c.kind).length
    expect(correct / CASES.length).toBeGreaterThanOrEqual(0.9)
  })

  it('only returns known kinds', () => {
    for (const c of CASES) expect(LIST_KINDS).toContain(classifyListKind(c.q))
  })
})

describe('backfillRecipeSections', () => {
  it('splits ingredients (with amount) from cooking steps when model left sections empty', () => {
    const items = [
      { title: 'Сахар — 400 г' },
      { title: 'Вода — 200 мл' },
      { title: 'Смешать сахар и воду' },
      { title: 'Взбить массу' },
    ]
    backfillRecipeSections(items, true)
    expect(items.map((i) => (i as { section?: string }).section)).toEqual([
      'Ингредиенты',
      'Ингредиенты',
      'Приготовление',
      'Приготовление',
    ])
  })

  it('respects sections the model already set (does not overwrite)', () => {
    const items = [{ title: 'Сахар — 400 г', section: 'Custom' }, { title: 'Смешать', section: 'Cook' }]
    backfillRecipeSections(items, true)
    expect(items.map((i) => i.section)).toEqual(['Custom', 'Cook'])
  })

  it('latches into steps — a later item with a dash stays a step', () => {
    const items = [{ title: 'Мука — 500 г' }, { title: 'Замесить тесто' }, { title: 'Выпекать 30–40 минут' }]
    backfillRecipeSections(items, true)
    expect((items[2] as { section?: string }).section).toBe('Приготовление')
  })
})
