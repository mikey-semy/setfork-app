import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodeCard } from '@/shared/ui/CodeCard'
import { TooltipProvider } from '@/shared/ui/Tooltip'

const card = (code: string) => (
  <TooltipProvider delay={0}>
    <CodeCard code={code} name="bash" lang="ru" />
  </TooltipProvider>
)

/**
 * ⚠️ СТРОКИ КОДА — ОДНОЙ ШИРИНЫ. Отступ под служебный угол получала только первая
 * строка, «чтобы не терять сотню пикселей на каждой». Цена оказалась выше экономии:
 * строка 1 переносилась там, где строки 2 и 3 такой же длины помещались целиком.
 * Перенос выглядел случайным, а главное — рвалось ВЫРАВНИВАНИЕ, которое в коде несёт
 * смысл: колонки «состояние → результат» переставали читаться (снимок владельца
 * 01.09.2026). Место возвращено иначе: номера строк и бейдж языка на телефоне скрыты.
 */
const CODE = 'активный        -> ДОСТУП ЕСТЬ\nзаблокирован    -> ДОСТУП ЕСТЬ'

const rows = (code = CODE) => {
  const { container } = render(card(code))
  return [...container.querySelectorAll('.sf-code-card > div > div')] as HTMLElement[]
}

describe('карточка кода', () => {
  it('правый отступ одинаков у всех строк', () => {
    const pads = rows().map((r) =>
      r.className
        .split(/\s+/)
        .filter((c) => /^(sm:)?pr-/.test(c))
        .sort()
        .join(' '),
    )
    expect(pads.length).toBeGreaterThan(1)
    expect(new Set(pads).size, `отступы разъехались: ${JSON.stringify(pads)}`).toBe(1)
  })

  it('на телефоне номера строк скрыты, а на печати и на широком экране — нет', () => {
    const num = rows()[0].querySelector('span') as HTMLElement
    expect(num.textContent).toBe('1')
    expect(num.className).toMatch(/\bhidden\b/)
    expect(num.className).toMatch(/sm:inline-block/)
    expect(num.className).toMatch(/print:inline-block/)
  })

  it('бейдж языка на телефоне скрыт: он служебный и стоит места у каждой строки', () => {
    const { container } = render(card(CODE))
    const badge = [...container.querySelectorAll('span')].find((s) => s.textContent === 'bash') as HTMLElement
    expect(badge.className).toMatch(/\bhidden\b/)
    expect(badge.className).toMatch(/sm:inline/)
  })

  it('перенос длинных строк остаётся: код показывают в своей форме, без бокового скролла', () => {
    const text = rows()[0].querySelector('span:last-child') as HTMLElement
    expect(text.className).toMatch(/whitespace-pre-wrap/)
  })
})
