import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloatingActions } from '@/shared/ui/FloatingActions'

/**
 * ПАНЕЛЬ ДЕЙСТВИЙ УХОДИТ, ПОКА ЗАНЯТА ПОЛОСА НАД КЛАВИАТУРОЙ.
 *
 * На узком экране с открытой клавиатурой `KeyboardDock` держит отмену и повтор на
 * `bottom: gap`. Плавающие действия формы садятся на `bottom: gap + 20` — то есть ровно
 * поверх правого края дока, где эти кнопки и стоят. Оба слоя `z-40`, панель рисуется
 * позже, поэтому перекрывает она.
 *
 * Чем это кончается: человек правит текст, тянется отменить последнюю правку — и попадает
 * в кнопку формы. На странице создания это отправка, на странице ПРАВКИ — публикация новой
 * версии списка, то есть git-коммит, которого он не заказывал. Найдено авто-ревью
 * 22.09.2026 (P1); глазами я это пропустил, потому что проверял панель на странице без
 * открытой клавиатуры.
 *
 * Проверяем поведение, а не разметку: сам факт «панель в DOM или нет» при появлении и
 * исчезновении признака дока. Признак — общий (`data-keyboard-dock`), тем же приёмом
 * `ScrollToTop` следит за `[data-sticky-input]`.
 */
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

/** Док, каким его рисует KeyboardDock: признак + полоса на всю ширину. */
function mountDock() {
  const dock = document.createElement('div')
  dock.setAttribute('data-keyboard-dock', '')
  dock.textContent = 'отменить · повторить'
  document.body.appendChild(dock)
  return dock
}

describe('плавающие действия и полоса над клавиатурой', () => {
  it('без дока панель на месте', () => {
    render(
      <FloatingActions>
        <button type="submit">Опубликовать v5</button>
      </FloatingActions>,
    )
    expect(screen.getByRole('button', { name: 'Опубликовать v5' })).toBeTruthy()
  })

  it('док уже открыт при первой отрисовке — панели нет', () => {
    // Порядок важен: страница правки может отрисоваться, когда поле уже в фокусе
    // (возврат по истории, автофокус). Проверка только на появление дока ПОСЛЕ монтирования
    // пропустила бы этот случай.
    mountDock()
    render(
      <FloatingActions>
        <button type="submit">Опубликовать v5</button>
      </FloatingActions>,
    )
    expect(screen.queryByRole('button', { name: 'Опубликовать v5' })).toBeNull()
  })

  it('док появился позже — панель уходит', async () => {
    render(
      <FloatingActions>
        <button type="submit">Опубликовать v5</button>
      </FloatingActions>,
    )
    expect(screen.getByRole('button', { name: 'Опубликовать v5' })).toBeTruthy()
    await act(async () => {
      mountDock()
      // MutationObserver вызывает наблюдателя микрозадачей — даём ей пройти.
      await Promise.resolve()
    })
    expect(
      screen.queryByRole('button', { name: 'Опубликовать v5' }),
      'панель осталась поверх отмены/повтора: тап по ним опубликует версию',
    ).toBeNull()
  })

  it('фокус ушёл из поля, док исчез — панель возвращается', async () => {
    const dock = mountDock()
    render(
      <FloatingActions>
        <button type="submit">Опубликовать v5</button>
      </FloatingActions>,
    )
    expect(screen.queryByRole('button', { name: 'Опубликовать v5' })).toBeNull()
    await act(async () => {
      dock.remove()
      await Promise.resolve()
    })
    // Вторая половина правила: если панель не вернётся, кнопка исчезнет навсегда после
    // первого же касания текста — и сохранить список станет нечем.
    expect(
      screen.queryByRole('button', { name: 'Опубликовать v5' }),
      'панель не вернулась после закрытия клавиатуры — сохранить стало нечем',
    ).toBeTruthy()
  })
})
