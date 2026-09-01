import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CommandText } from '@/shared/ui/CommandText'

/**
 * Три свойства блока команды, каждое из которых уже ломалось.
 */
describe('показ команды', () => {
  const code = (ui: React.ReactElement) =>
    (render(ui).container.querySelector('code') as HTMLElement)

  it('прокручиваемый блок достижим клавиатурой — иначе спрятанный текст недоступен без мыши', () => {
    expect(code(<CommandText value="docker run --rm -v /very/long/path" />).tabIndex).toBe(0)
  })

  it('внутри кнопки своей точки остановки нет: вложенный фокус ломает обход', () => {
    const el = code(<CommandText value="npm ci" focusable={false} />)
    expect(el.hasAttribute('tabindex')).toBe(false)
  })

  it('на печати переносится, а не обрезается: прокрутки на бумаге нет', () => {
    // Прямые применения (карточка кандидата, разбор правок) печатаются без CodeCard —
    // с одной лишь прокруткой бумага потеряла бы всё правее видимой ширины.
    const cls = code(<CommandText value="set -e" />).className
    expect(cls).toMatch(/print:whitespace-pre-wrap/)
    expect(cls).toMatch(/print:overflow-visible/)
  })
})
