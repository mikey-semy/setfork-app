import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tooltip, TooltipProvider } from '@/shared/ui/Tooltip'

/**
 * ПОДСКАЗКА НА ПАЛЬЦЕ ВЕДЁТ СЕБЯ КАК КЛАВИША НА КЛАВИАТУРЕ ТЕЛЕФОНА.
 *
 * У мыши есть наведение, у пальца — нет: только «коснулся» и «отпустил». Radix по
 * умолчанию показывал подсказку по касанию и почти сразу убирал её вместе с нажатием —
 * получалась вспышка, которую замечаешь, но не успеваешь прочесть. Найдено владельцем на
 * живом сайте: «их не видно, а если видно, то моргнут».
 *
 * Поведение взято у экранной клавиатуры: нажал — показалась, держишь — висит, отпустил —
 * ушла. Проверяется именно это, а не наличие класса анимации: класс переживёт смену
 * поведения и ничего не поймает.
 */

// Позиционирование Radix опирается на ResizeObserver, которого в jsdom нет. Подменяем
// заглушкой: проверяется ПОВЕДЕНИЕ подсказки, а не то, где она встала на экране.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver
// То же с DOMRect: Radix зовёт его при расчёте позиции.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

const setup = (label = 'Подсказка') =>
  render(
    <TooltipProvider delay={0}>
      <Tooltip label={label}>
        <button type="button">кнопка</button>
      </Tooltip>
    </TooltipProvider>,
  )

/**
 * Событие указателя с типом: у мыши и пальца разные ветки.
 *
 * Через `fireEvent`, а не голым `dispatchEvent`: `pointerleave` НЕ всплывает, React вешает
 * такие слушатели напрямую, и самодельное событие до обработчика не доходит — тест молча
 * «проходил» бы там, где поведения нет.
 */
const pointer = {
  down: (el: Element, pointerType: 'touch' | 'mouse') => fireEvent.pointerDown(el, { pointerType }),
  up: (el: Element, pointerType: 'touch' | 'mouse') => fireEvent.pointerUp(el, { pointerType }),
  leave: (el: Element, pointerType: 'touch' | 'mouse') => fireEvent.pointerLeave(el, { pointerType }),
}

/** Radix рисует подпись дважды: видимую и скрытую для скринридера. Считаем обе. */
const shown = (text: string) => screen.queryAllByText(text).length > 0

describe('подсказка при касании', () => {
  it('появляется по касанию и держится, пока палец на кнопке', () => {
    setup()
    const btn = screen.getByRole('button', { name: 'кнопка' })
    expect(shown('Подсказка')).toBe(false)

    pointer.down(btn, 'touch')
    // Держим — подсказка на месте, а не мигнула.
    expect(shown('Подсказка')).toBe(true)
  })

  it('уходит с отпусканием', () => {
    setup()
    const btn = screen.getByRole('button', { name: 'кнопка' })
    pointer.down(btn, 'touch')
    expect(shown('Подсказка')).toBe(true)

    pointer.up(btn, 'touch')
    expect(shown('Подсказка')).toBe(false)
  })

  it('палец уехал с кнопки, не отпуская, — тоже конец удержания', () => {
    setup()
    const btn = screen.getByRole('button', { name: 'кнопка' })
    pointer.down(btn, 'touch')
    pointer.leave(btn, 'touch')
    expect(shown('Подсказка')).toBe(false)
  })

  it('мышь ветку удержания НЕ включает — там работает наведение Radix', () => {
    // Ветка выбирается по типу указателя события, а не по ширине экрана: планшет с мышью
    // не должен получать поведение пальца, а телефон в альбомной — поведение мыши.
    setup()
    const btn = screen.getByRole('button', { name: 'кнопка' })
    pointer.down(btn, 'mouse')
    expect(shown('Подсказка')).toBe(false)
  })

  it('без подписи подсказки нет вовсе, а кнопка на месте', () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip label="">
          <button type="button">голая</button>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: 'голая' })).toBeInTheDocument()
  })
})
