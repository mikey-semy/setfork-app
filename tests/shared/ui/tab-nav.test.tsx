import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TabItem } from '@/shared/ui/TabNav'

describe('счётчик вкладки', () => {
  it('центрирует число внутри фиксированного круглого бейджа', () => {
    render(<TabItem href="/alice?tab=lists" on={false} label="Lists" count={3} />)

    expect(screen.getByText('3')).toHaveClass('inline-flex', 'h-5', 'min-w-5', 'items-center', 'justify-center', 'leading-none')
  })
})

describe('какая вкладка текущая — не только на вид', () => {
  it('активная объявляется, соседние — нет', () => {
    // `data-active` двигает полоску и меняет начертание: оба признака зрительные, и в
    // скринридере ряд звучал как несколько одинаковых ссылок подряд — «где я» не отвечал
    // никто. Нашлось при переводе страницы прогонов на этот примитив: рукописный ряд,
    // который он заменил, `aria-current` ставил, а примитив — нет.
    // Без обёртки TabNav: она клиентская и меряет ширины через refs, а проверяется здесь
    // сам пункт ряда — атрибут ставит он.
    render(
      <>
        <TabItem href="/a" on label="Первая" />
        <TabItem href="/b" on={false} label="Вторая" />
      </>,
    )
    expect(screen.getByRole('link', { name: 'Первая' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Вторая' })).not.toHaveAttribute('aria-current')
  })
})
