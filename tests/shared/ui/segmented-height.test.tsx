import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'
import { CONTROL_H } from '@/shared/ui/control'

/**
 * ⚠️ ВЫСОТУ ОБОЙМЫ ЗАДАЁТ ОБОЙМА, А НЕ СЕГМЕНТЫ ВНУТРИ.
 *
 * Ступень шкалы стояла на сегменте, а обойма добавляла поверх свой отступ и рамку. В
 * ряду с полем и селектами переключатель выходил на 38px против 32 у соседей — владелец
 * увидел это на проде 02.09.2026 и спросил, почему опять разные высоты. Собственная
 * узда шкалы такого не ловит: она смотрит на контролы, а не на сумму «контрол + его
 * обёртка».
 */
describe('высота сегментной обоймы', () => {
  const box = (size?: 'sm' | 'md') => {
    const { container } = render(
      <SegmentedControl label="Вид" size={size}>
        <Segment active onClick={() => {}}>
          A
        </Segment>
        <Segment active={false} onClick={() => {}}>
          B
        </Segment>
      </SegmentedControl>,
    )
    return container.firstElementChild as HTMLElement
  }

  it('обойма несёт ступень шкалы', () => {
    expect(box('md').className.split(/\s+/)).toContain(CONTROL_H.md)
    expect(box('sm').className.split(/\s+/)).toContain(CONTROL_H.sm)
  })

  it('сегмент растягивается по обойме, а не задаёт ей высоту', () => {
    const seg = box('md').querySelector('button') as HTMLElement
    expect(seg.className.split(/\s+/), 'сумма сегмента и отступа снова выйдет за ступень').toContain('h-full')
    for (const h of Object.values(CONTROL_H)) {
      expect(seg.className.split(/\s+/), `сегмент держит свою высоту ${h}`).not.toContain(h)
    }
  })
})
