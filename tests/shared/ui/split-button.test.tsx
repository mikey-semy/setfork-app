import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SplitButton } from '@/shared/ui/SplitButton'
import { CONTROL_H, TOUCH_HIT } from '@/shared/ui/control'
import { splitSegment } from '@/shared/ui/split-segment'

/**
 * АНАТОМИЯ СПЛИТ-КНОПКИ ОДНА НА ВСЕ КНОПКИ РЯДА.
 *
 * Кнопки «Следить», «Звезда» и «Форк» собирались вручную и разъезжались по мелочам: у
 * звезды каретка оказалась без разделителя и без подложки, у «Следить» разделитель не
 * менял цвет вместе с состоянием, размеры кареток отличались. Владелец сказал прямо: это
 * читается как две разные кнопки.
 *
 * Тест держит правило: между соседними сегментами всегда есть разделитель, и он окрашен
 * тоном группы — то есть подсвеченная кнопка остаётся цельной, а не «крашеной слева».
 */
const seg = (text: string) => (
  <span key={text} className={splitSegment({ interactive: false })}>
    {text}
  </span>
)

const dividers = (root: HTMLElement) => [...root.querySelectorAll('[aria-hidden="true"]')]

describe('сплит-кнопка', () => {
  it('между сегментами появляется разделитель, по краям — нет', () => {
    const { container } = render(<SplitButton>{[seg('действие'), seg('7'), seg('▾')]}</SplitButton>)
    expect(screen.getByText('действие')).toBeDefined()
    // Три сегмента → ровно два разделителя (между ними), не четыре и не ноль.
    expect(dividers(container)).toHaveLength(2)
  })

  it('одинокий сегмент разделителей не получает', () => {
    const { container } = render(<SplitButton>{[seg('только действие')]}</SplitButton>)
    expect(dividers(container)).toHaveLength(0)
  })

  it('пустые слоты не оставляют лишних линий', () => {
    // Счётчик прячется при нуле — соседние разделители не должны «повисать».
    const { container } = render(<SplitButton>{[seg('действие'), null, seg('▾')]}</SplitButton>)
    expect(dividers(container)).toHaveLength(1)
  })

  it('тон красит и рамку, и разделители — группа выглядит цельной', () => {
    const { container } = render(<SplitButton tone="warn">{[seg('★'), seg('▾')]}</SplitButton>)
    const group = container.firstElementChild as HTMLElement
    expect(group.className).toContain('border-warn')
    expect(dividers(container)[0].className).toContain('bg-warn/40')
  })

  it('нейтральный тон не подсвечивает ничего', () => {
    const { container } = render(<SplitButton>{[seg('⑂'), seg('810')]}</SplitButton>)
    const group = container.firstElementChild as HTMLElement
    expect(group.className).toContain('border-border')
    // Нейтральная кнопка всё равно выглядит активной, как соседние Pin/Share:
    // прозрачный фон визуально превращал все три средних сплита в disabled.
    expect(group.className).toContain('bg-surface-2')
    expect(dividers(container)[0].className).toContain('bg-border')
  })

  // Высота сверяется СО ШКАЛОЙ, а не с литералом: 02.08.2026 лестница поднялась на
  // ступень (28→32), и зашитый 'h-9' сделал бы падение теста единственным признаком
  // того, что сплит-кнопка отстала от ряда. Теперь тест держит само правило.
  it('высота группы — из шкалы контролов, ряд не разъезжается', () => {
    const { container } = render(<SplitButton>{[seg('a')]}</SplitButton>)
    const group = container.firstElementChild as HTMLElement
    expect(group.className).toContain(CONTROL_H.md)
    // На touch видимая кнопка остаётся 32px; 44px раньше делали средние кнопки
    // выше двух крайних. Это не должно вернуться через TOUCH_MIN_H.
    expect(group.className).not.toContain('pointer-coarse:min-h-11')
  })

  it('на touch увеличивает только область нажатия интерактивного сегмента', () => {
    const { container } = render(
      <SplitButton>
        <button type="button" className={splitSegment()}>
          действие
        </button>
        <span className={splitSegment({ interactive: false })}>3</span>
      </SplitButton>,
    )
    const group = container.firstElementChild as HTMLElement
    const button = container.querySelector('button') as HTMLButtonElement
    const count = screen.getByText('3')

    expect(group).toHaveClass('pointer-coarse:overflow-visible')
    expect(button).toHaveClass(...TOUCH_HIT.split(' '))
    expect(count.className).not.toContain('pointer-coarse:before:h-11')
  })
})
