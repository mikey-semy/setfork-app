import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloatingActions } from '@/shared/ui/FloatingActions'

/**
 * ПАНЕЛЬ ДЕЙСТВИЙ ВСТАЁТ НАД ПОЛОСОЙ НАД КЛАВИАТУРОЙ, А НЕ ПОВЕРХ НЕЁ И НЕ ИСЧЕЗАЕТ.
 *
 * На узком экране с фокусом в поле `KeyboardDock` держит отмену и повтор внизу. Панель
 * действий садилась на 20px выше — то есть ровно на правый край дока, где эти кнопки и
 * стоят. Человек тянулся отменить правку и попадал в кнопку формы: на странице правки
 * это публикация новой версии, git-коммит, которого он не заказывал.
 *
 * ⚠️ Первая починка панель ПРЯТАЛА — и передвинула беду, а не убрала. Авто-ревью нашло
 * два следствия, и оба хуже исходного:
 *   · кнопка «наверх» ищет нижнюю панель по `[data-sticky-input]`. Панель исчезала —
 *     и «наверх» садилась ровно на тот же правый край дока, на ту же отмену;
 *   · док включается по фокусу на узком экране независимо от того, есть ли виртуальная
 *     клавиатура. Человек, идущий по форме табом, переставал находить «Сохранить» и
 *     «Опубликовать» вовсе — кнопки пропадали из дерева, а не просто с глаз.
 *
 * Поэтому проверяем не «исчезла», а «поднялась выше дока и осталась доступной».
 */
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const DOCK_HEIGHT = 48

/** Док, каким его рисует KeyboardDock: признак, полоса на всю ширину, своя высота. */
function mountDock(height = DOCK_HEIGHT) {
  const dock = document.createElement('div')
  dock.setAttribute('data-keyboard-dock', '')
  dock.textContent = 'отменить · повторить'
  // jsdom не считает раскладку, поэтому высоту задаём сами — иначе замер вернёт 0
  // и тест зеленел бы на любом поведении.
  dock.getBoundingClientRect = () => ({ height, width: 320, top: 0, left: 0, right: 320, bottom: height, x: 0, y: 0, toJSON: () => ({}) })
  document.body.appendChild(dock)
  return dock
}

const panel = () => document.querySelector<HTMLElement>('[data-floating-actions]')
const bottomOf = (el: HTMLElement | null) => (el ? Number.parseInt(el.style.bottom || '0', 10) : null)

const mount = () =>
  render(
    <FloatingActions>
      <button type="submit">Опубликовать v5</button>
    </FloatingActions>,
  )

describe('плавающие действия и полоса над клавиатурой', () => {
  it('без дока панель сидит у самого низа', () => {
    mount()
    expect(bottomOf(panel())).toBe(20)
  })

  it('док уже открыт при первой отрисовке — панель сразу выше него', () => {
    // Порядок важен: страница может отрисоваться, когда поле уже в фокусе (возврат по
    // истории, автофокус). Проверка только на появление дока ПОСЛЕ монтирования такой
    // случай пропустила бы.
    mountDock()
    mount()
    expect(bottomOf(panel())).toBe(DOCK_HEIGHT + 12)
  })

  it('док появился позже — панель поднимается', async () => {
    mount()
    expect(bottomOf(panel())).toBe(20)
    await act(async () => {
      mountDock()
      await Promise.resolve()
    })
    expect(bottomOf(panel()), 'панель осталась на правом краю дока: тап по отмене опубликует версию').toBe(DOCK_HEIGHT + 12)
  })

  it('кнопки НЕ пропадают из дерева, пока док открыт', async () => {
    // Вторая половина правила и причина, по которой прятать панель нельзя: человек с
    // физической клавиатурой идёт табом и должен найти «Опубликовать».
    mount()
    await act(async () => {
      mountDock()
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Опубликовать v5' }), 'кнопки исчезли из обхода табом').toBeTruthy()
  })

  it('фокус снят, док исчез — панель возвращается вниз', async () => {
    const dock = mountDock()
    mount()
    expect(bottomOf(panel())).toBe(DOCK_HEIGHT + 12)
    await act(async () => {
      dock.remove()
      await Promise.resolve()
    })
    expect(bottomOf(panel()), 'панель зависла над пустым местом').toBe(20)
  })

  it('док выше — панель выше: зазор считается от его РЕАЛЬНОЙ высоты', async () => {
    // Док растёт, когда его кнопки переносятся. Жёсткое число вместо замера снова дало бы
    // перекрытие — на этот раз молча.
    mount()
    await act(async () => {
      mountDock(96)
      await Promise.resolve()
    })
    expect(bottomOf(panel())).toBe(96 + 12)
  })
})
