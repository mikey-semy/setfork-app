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

/**
 * Строки кода. Второй блок карточки — первый занят служебной полосой; внутри него
 * обёртка, задающая общую ширину всем строкам (без неё короткие уезжают из видимой
 * области при прокрутке и уносят прилипшие номера).
 */
const rows = (code = CODE) => {
  const { container } = render(card(code))
  return [...container.querySelectorAll('.sf-code-card > div:last-child > div > div')] as HTMLElement[]
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

  /**
   * ⚠️ ЭКРАН И БУМАГА РАЗОШЛИСЬ НАМЕРЕННО. Перенос стоял всюду по правилу «код
   * показывают в его форме» (#407), но на телефоне он рвал строку посреди выражения:
   * `failures = append(failures,` и `common.Failure{` оказывались на разных строках.
   * Структура кода — то, ради чего его читают, — рассыпалась (снимок владельца
   * 02.09.2026). На бумаге прокрутки нет физически, там перенос остаётся.
   */
  it('на экране строка не рвётся: прокрутка вместо переноса', () => {
    const text = rows()[0].querySelector('span:last-child') as HTMLElement
    expect(text.className).toMatch(/whitespace-pre\b/)
    expect(text.className).not.toMatch(/whitespace-pre-wrap(?!\s*print)/)
  })

  it('на печати строка переносится: прокрутить бумагу нельзя', () => {
    const text = rows()[0].querySelector('span:last-child') as HTMLElement
    expect(text.className).toMatch(/print:whitespace-pre-wrap/)
  })

  it('номера при прокрутке закреплены: уехавшая нумерация бесполезна', () => {
    const num = rows()[0].querySelector('span') as HTMLElement
    expect(num.className).toMatch(/\bsticky\b/)
    expect(num.className).toMatch(/print:static/)
  })

  it('ширина одна на все строки: короткая не уезжает и не уносит свой номер', () => {
    const { container } = render(card('x\nочень длинная строка кода, которая и задаёт ширину прокрутки'))
    const track = container.querySelector('.sf-code-card > div:last-child > div') as HTMLElement
    expect(track.className, 'ширину просят у каждой строки — короткая получит свою').toMatch(/w-max/)
    for (const row of rows('x\nочень длинная строка кода, которая и задаёт ширину прокрутки')) {
      expect(row.className).toMatch(/\bw-full\b/)
      expect(row.className).not.toMatch(/\bw-max\b/)
    }
  })

  it('горизонтальный жест внутри блока не листает страницу', () => {
    const { container } = render(card(CODE))
    const body = container.querySelector('.sf-code-card > div:last-child') as HTMLElement
    expect(body.className).toMatch(/overflow-x-auto/)
    expect(body.className, 'без overscroll-contain свайп по коду листает страницу').toMatch(/overscroll-x-contain/)
  })
})
