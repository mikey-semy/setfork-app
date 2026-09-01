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
 * ⚠️ СТРОКИ КОДА — ОДНОЙ ШИРИНЫ, И ВСЁ СЛУЖЕБНОЕ ЖИВЁТ ВНЕ ИХ ПОЛОСЫ.
 *
 * Пройдено два неверных размена. Сначала отступ под угол получала только первая строка:
 * она переносилась там, где соседние такой же длины помещались целиком, и рвалось
 * выравнивание, которое в коде несёт смысл. Потом отступ выдали всем строкам, а место
 * отняли у номеров и имени языка — владелец сразу спросил, куда они делись.
 *
 * Итог: служебное вынесено в полосу над кодом (28px один раз на блок), а код идёт во всю
 * ширину. Номера и язык видны везде.
 */
const CODE = 'активный        -> ДОСТУП ЕСТЬ\nзаблокирован    -> ДОСТУП ЕСТЬ'

/** Строки кода: второй блок карточки — первый занят служебной полосой. */
const rows = (code = CODE) => {
  const { container } = render(card(code))
  return [...container.querySelectorAll('.sf-code-card > div:last-child > div')] as HTMLElement[]
}

describe('карточка кода', () => {
  it('правый отступ у строк одинаков — и его нет вовсе: код во всю ширину', () => {
    const pads = rows().map((r) => r.className.split(/\s+/).filter((c) => /^(sm:|print:)?pr-/.test(c)))
    expect(rows().length).toBeGreaterThan(1)
    expect(pads.flat(), 'место под служебный угол снова отнимают у кода').toEqual([])
  })

  it('номера строк на месте — на любой ширине', () => {
    const num = rows()[0].querySelector('span') as HTMLElement
    expect(num.textContent).toBe('1')
    expect(num.className, 'номера прятали на телефоне ради ширины — так больше не платим').not.toMatch(/\bhidden\b/)
  })

  it('имя языка показано и не спрятано за ширину', () => {
    const { container } = render(card(CODE))
    const badge = [...container.querySelectorAll('span')].find((x) => x.textContent === 'bash') as HTMLElement
    expect(badge, 'язык блока не показан вовсе').toBeTruthy()
    expect(badge.className).not.toMatch(/\bhidden\b/)
  })

  it('служебная полоса на печать не идёт: там нечего копировать', () => {
    const { container } = render(card(CODE))
    const bar = container.querySelector('.sf-code-card > div') as HTMLElement
    expect(bar.className).toMatch(/print:hidden/)
  })

  it('перенос длинных строк остаётся: код показывают в своей форме, без бокового скролла', () => {
    const text = rows()[0].querySelector('span:last-child') as HTMLElement
    expect(text.className).toMatch(/whitespace-pre-wrap/)
  })
})
