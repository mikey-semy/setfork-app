import { describe, expect, it } from 'vitest'
import { itemShape, itemShapeLean } from '@/features/mcp/registry/block-schema'

/**
 * ОБЛЕГЧЁННАЯ ФОРМА БЛОКА НЕ УБАВЛЯЕТ ВОЗМОЖНОСТЕЙ.
 *
 * Поля редких типов (quiz/poll/video/image/file) убраны из ОБЪЯВЛЕНИЯ четырёх
 * пишущих инструментов ради чужих токенов: список инструментов уходит в контекст
 * агента при каждом запросе, и эта схема повторялась в нём пять раз. Но приниматься
 * они обязаны по-прежнему — иначе экономия обернулась бы тихой потерей данных.
 *
 * ⚠️ Проверяем ПУТЬ ЦЕЛИКОМ, как он идёт в обработчике: облегчённая форма пропускает
 * незнакомые поля (`passthrough`), полная — разбирает их в типизированные. Проверка на
 * «в схеме нет ключа quiz» этого бы не доказала: она про текст схемы, а не про то,
 * доедут ли данные.
 */
const quizBlock = {
  type: 'quiz' as const,
  question: 'Сколько токенов сэкономили?',
  options: [{ text: '2251', correct: true }, { text: 'нисколько' }],
  explain: 'замер 19.09.2026',
}

describe('облегчённая форма блока', () => {
  it('⚠️ поля теста ПРОХОДЯТ сквозь облегчённую форму и разбираются полной', () => {
    const lean = itemShapeLean.parse(quizBlock)
    expect(lean, 'passthrough обязан сохранить незнакомые поля').toMatchObject({ question: quizBlock.question })
    const full = itemShape.parse(lean)
    expect(full.question).toBe(quizBlock.question)
    expect(full.options).toHaveLength(2)
    expect(full.explain).toBe(quizBlock.explain)
  })

  it('обычный шаг разбирается так же, как раньше', () => {
    const step = { type: 'step' as const, title: 'Поставить зависимости', command: 'npm ci', level: 'required' as const }
    expect(itemShape.parse(itemShapeLean.parse(step))).toMatchObject(step)
  })

  it('в облегчённой форме объявлены поля шага и текста — то, чем пользуются в 98% блоков', () => {
    const keys = Object.keys(itemShapeLean.shape)
    for (const k of ['type', 'bid', 'section', 'title', 'desc', 'command', 'level', 'text']) expect(keys).toContain(k)
    for (const k of ['question', 'options', 'blanks', 'tolerance']) expect(keys).not.toContain(k)
  })
})
