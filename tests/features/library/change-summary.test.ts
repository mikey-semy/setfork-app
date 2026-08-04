import { describe, expect, it } from 'vitest'
import { flatToCmp, hasChanges, summarizeDiffForNote } from '@/features/library/change-summary'
import { diffSteps } from '@/features/library/diff'

const step = (title: string, extra: Partial<{ desc: string; command: string; subtasks: string[] }> = {}) => ({
  title,
  desc: extra.desc ?? '',
  command: extra.command ?? '',
  subtasks: extra.subtasks ?? [],
})

const summarize = (from: ReturnType<typeof step>[], to: ReturnType<typeof step>[]) => {
  const { entries, summary } = diffSteps(flatToCmp(from), flatToCmp(to))
  return { text: summarizeDiffForNote(entries), summary, changed: hasChanges(summary) }
}

describe('изменений нет', () => {
  it('одинаковые списки — модель звать незачем', () => {
    const items = [step('Установить VS Code'), step('Проверить версию', { command: 'code --version' })]
    const r = summarize(items, items)
    expect(r.changed).toBe(false)
    expect(r.text).toBe('')
  })
})

describe('правка, которую старый способ не видел', () => {
  it('поменяли символ в описании — это видно в диффе', () => {
    const r = summarize(
      [step('Установить VS Code', { desc: 'Ставим редактор.' })],
      [step('Установить VS Code', { desc: 'Ставим редактор!' })],
    )
    expect(r.changed).toBe(true)
    expect(r.text).toContain('changed')
    expect(r.text).toContain('desc')
    // Модель должна увидеть «было → стало», иначе опять начнёт сочинять.
    expect(r.text).toContain('Ставим редактор.')
    expect(r.text).toContain('Ставим редактор!')
  })

  it('правка команды тоже видна', () => {
    const r = summarize([step('Проверить', { command: 'code -v' })], [step('Проверить', { command: 'code --version' })])
    expect(r.text).toContain('command')
    expect(r.text).toContain('code --version')
  })

  it('правка подпунктов видна', () => {
    const r = summarize([step('Шаг', { subtasks: ['раз'] })], [step('Шаг', { subtasks: ['раз', 'два'] })])
    expect(r.text).toContain('subtasks')
  })
})

describe('структурные изменения', () => {
  it('добавление и удаление подписаны отдельно', () => {
    const r = summarize([step('Первый'), step('Второй')], [step('Первый'), step('Третий')])
    expect(r.changed).toBe(true)
    expect(r.text).toMatch(/added|removed|changed/)
  })

  it('длинный дифф обрезается, но сообщает про остаток', () => {
    // 30 изменённых блоков при лимите 20: показываем часть и честно говорим,
    // сколько осталось, — молчаливая обрезка выглядела бы как «остальное не менялось».
    const from = Array.from({ length: 30 }, (_, i) => step(`Шаг ${i}`))
    const to = from.map((s, i) => step(`Шаг ${i}`, { desc: `новое ${i}` }))
    const r = summarize(from, to)
    expect(r.text.split('\n').filter((l) => l.startsWith('*')).length).toBe(20)
    expect(r.text).toContain('and 10 more block(s)')
  })
})
