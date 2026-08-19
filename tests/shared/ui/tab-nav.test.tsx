import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TabItem } from '@/shared/ui/TabNav'
import { TooltipProvider } from '@/shared/ui/Tooltip'

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

describe('узкий экран: значок вместо подписи', () => {
  /**
   * Прежде прятался ЗНАЧОК, а подпись оставалась: считалось, что подписи «короткие и
   * однозначные». На русском они не короткие — «Завершённые», «Новое обсуждение», — и в
   * ряд не влезали: текст вылезал за вкладку. Найдено владельцем на живом сайте.
   *
   * Проверяем не пиксели, а РЕШЕНИЕ: что именно прячется на узком экране и остаётся ли
   * подпись доступной, когда её не видно.
   */
  it('со значком: подпись прячется до sm, но остаётся доступным именем', () => {
    // Вкладка со значком оборачивается подсказкой, а той нужен провайдер (он есть в
    // layout приложения).
    render(
      <TooltipProvider delay={0}>
        <TabItem href="/a" on={false} icon={<span>💬</span>} label="Общее" count={3} />
      </TooltipProvider>,
    )
    const link = screen.getByRole('link', { name: 'Общее' })
    expect(link).toHaveAttribute('aria-label', 'Общее')
    // Видимая подпись скрыта до sm; значок виден всегда.
    expect(screen.getByText('Общее').className).toContain('hidden')
    expect(screen.getByText('💬').className).not.toContain('hidden')
    // Счётчик остаётся: на узком экране он и есть главное число вкладки.
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('без значка: подпись видна всегда — иначе от вкладки осталась бы пустота', () => {
    render(<TabItem href="/b" on={false} label="Завершённые" />)
    expect(screen.getByText('Завершённые').className ?? '').not.toContain('hidden')
  })
})
