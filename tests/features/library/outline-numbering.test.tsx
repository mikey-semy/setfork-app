import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CourseOutline } from '@/features/library/CourseOutline'

/**
 * ОГЛАВЛЕНИЕ НЕ ДУБЛИРУЕТ НОМЕР АВТОРА.
 *
 * Список, созданный через MCP, назвал секции «1. Подтверждение оповещения» — а оглавление
 * ставит рядом свою единицу. Найдено владельцем на живом списке; убрать номер из текста он
 * не мог, пока черновик не опубликован, отсюда и «неубираемая информация».
 *
 * Проверяется ВИДИМЫЙ результат — что номер показан один раз, — а не то, каким классом он
 * нарисован: рецепт разметки переживёт смену поведения и ничего не поймает.
 */

const lesson = (title: string) => ({ title, anchor: 'a-' + title, quizTotal: 0, quizPassed: 0 })

const show = (titles: string[]) =>
  render(<CourseOutline lessons={titles.map(lesson)} showProgress={false} lang="ru" />)

describe('оглавление', () => {
  it('номер автора показан один раз, а не рядом со своим', () => {
    show(['1. Подтверждение оповещения', '2. Оценка масштаба'])
    // Текст пункта — без номера; номер живёт в своей колонке.
    expect(screen.getByText('Подтверждение оповещения')).toBeInTheDocument()
    expect(screen.queryByText('1. Подтверждение оповещения')).toBeNull()
    expect(screen.getAllByText('1')).toHaveLength(1)
  })

  it('без нумерации автора считает само', () => {
    show(['Обнаружение', 'Восстановление'])
    expect(screen.getByText('Обнаружение')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('многоуровневую нумерацию автора показывает как есть — сама такую не умеет', () => {
    show(['1.1. Введение', '1.2. Порядок'])
    expect(screen.getByText('1.1')).toBeInTheDocument()
    expect(screen.getByText('Введение')).toBeInTheDocument()
  })

  it('заголовок, начинающийся с числа, не разваливается на номер и остаток', () => {
    show(['1.5 л воды', '7 способов заварить чай'])
    expect(screen.getByText('1.5 л воды')).toBeInTheDocument()
    expect(screen.getByText('7 способов заварить чай')).toBeInTheDocument()
  })
})
