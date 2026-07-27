import { describe, expect, it } from 'vitest'
import { JSON_SHAPE, parseList } from '@/shared/ai/generate'
import { toProposed, toStepInput } from '@/shared/lib/step-input'

// РЕГРЕССИЯ (найдена ревью 2026-07-27): refine получает текущий список JSON'ом и возвращает
// его ЦЕЛИКОМ. Поля, которого нет в снимке, нет и в ответе — то есть каждый проход ухода
// СТИРАЛ пометки «здесь нужен человек». Ошибка тихая: тесты пометки проверяли на пути
// генерации, а теряло её улучшение.
//
// Ловим два звена: форма JSON обязана содержать поля (иначе модель их не вернёт), а
// конвертеры — переносить их из ответа в снимок правки.

describe('форма JSON для refine', () => {
  it('содержит поля пометки — иначе модель их не вернёт', () => {
    expect(JSON_SHAPE).toContain('needsHuman')
    expect(JSON_SHAPE).toContain('needsHumanAsk')
  })
})

describe('ответ модели с пометкой', () => {
  const withMark = JSON.stringify({
    title: 'Хлеб',
    desc: '',
    tags: ['еда'],
    hint: '',
    items: [
      { title: 'Купить муку', desc: '', command: '', section: '', level: 'required', why: '', subtasks: [], refs: [], needsHuman: true, needsHumanAsk: 'Сколько стоит у вас?' },
      { title: 'Замесить', desc: '', command: '', section: '', level: 'required', why: '', subtasks: [], refs: [] },
    ],
  })

  it('пометка доезжает до шагов на запись, у непомеченного — явный false', () => {
    const parsed = parseList(withMark, 'x')
    const steps = toStepInput(toProposed(parsed!.items, 'ru'))
    expect(steps[0]).toMatchObject({ needsHuman: true, needsHumanAsk: { ru: 'Сколько стоит у вас?' } })
    expect(steps[1]).toMatchObject({ needsHuman: false, needsHumanAsk: {} })
  })

  it('снятая моделью пометка (человек ответил) не «прилипает» обратно', () => {
    const answered = JSON.stringify({
      title: 'Хлеб',
      desc: '',
      tags: ['еда'],
      hint: '',
      items: [{ title: 'Купить муку', desc: 'Мука 80 ₽/кг в Кирове', command: '', section: '', level: 'required', why: '', subtasks: [], refs: [], needsHuman: false }],
    })
    const steps = toStepInput(toProposed(parseList(answered, 'x')!.items, 'ru'))
    expect(steps[0]).toMatchObject({ needsHuman: false, needsHumanAsk: {} })
  })
})
