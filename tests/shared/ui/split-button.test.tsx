import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SplitButton } from '@/shared/ui/SplitButton'
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
    expect(dividers(container)[0].className).toContain('bg-border')
  })

  it('высота группы одна для всех — ряд не разъезжается', () => {
    const { container } = render(<SplitButton>{[seg('a')]}</SplitButton>)
    expect((container.firstElementChild as HTMLElement).className).toContain('h-9')
  })
})
