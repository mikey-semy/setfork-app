import { describe, expect, it } from 'vitest'
import { stepChunkContent } from '@/features/library/index-content'

const step = (over: Partial<Parameters<typeof stepChunkContent>[1]> = {}) => ({
  type: 'step',
  title: { ru: 'Замочить желатин' },
  desc: { ru: 'В холодной воде на 10 минут' },
  command: '',
  why: { ru: 'Иначе комками' },
  section: { ru: 'Подготовка' },
  subtasks: [{ ru: 'Вода прозрачная' }],
  ...over,
})

describe('stepChunkContent', () => {
  it('чанк несёт заголовок СПИСКА + секцию + шаг + why + subtasks', () => {
    const c = stepChunkContent('Маршмеллоу дома', step())!
    expect(c).toContain('Маршмеллоу дома · Подготовка: Замочить желатин')
    expect(c).toContain('В холодной воде')
    expect(c).toContain('Иначе комками')
    expect(c).toContain('Вода прозрачная')
  })

  it('command попадает в квадратных скобках', () => {
    const c = stepChunkContent('Деплой', step({ command: 'npm ci', section: null }))!
    expect(c).toContain('[npm ci]')
  })

  it('не-step блоки и шаги без осмысленного заголовка не индексируются', () => {
    expect(stepChunkContent('X', step({ type: 'text' }))).toBeNull()
    expect(stepChunkContent('X', step({ title: { ru: 'ок' } }))).toBeNull()
    expect(stepChunkContent('X', step({ title: null }))).toBeNull()
  })

  it('двуязычный заголовок шага разворачивается через « / »', () => {
    const c = stepChunkContent('List', step({ title: { en: 'Soak gelatin', ru: 'Замочить желатин' } }))!
    expect(c).toContain('Soak gelatin / Замочить желатин')
  })
})
