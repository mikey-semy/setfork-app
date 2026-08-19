import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CopyRow } from '@/shared/ui/CopyRow'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'

/**
 * СТРОКА СО ЗНАЧЕНИЕМ И КОПИРОВАНИЕМ — РОВНО ТОЙ ЖЕ ВЫСОТЫ, ЧТО КНОПКА.
 *
 * Своей высоты у неё не было вовсе: её считали отступы поверх кнопки копирования, и при
 * кнопке в 32px строки выходили в 54, 44 и 42px — три рукописных копии, три разных числа.
 * Найдено владельцем на живом сайте: «поле кода очень высокое». Узда линта такое ловит у
 * контролов, но контейнер здесь div, и правило до него не достаёт — значит стережёт тест.
 *
 * Высота НЕ записана сюда числом: она берётся из того же `buttonClass`, что и у кнопки.
 * Записать «h-8» значило бы проверять свою копию рецепта — при смене шкалы тест остался
 * бы зелёным, а строка разъехалась бы с кнопкой.
 */

const heightOf = (cls: string) => cls.split(/\s+/).find((c) => /^h-\d/.test(c))

const row = () => {
  const { container } = render(
    <TooltipProvider delay={0}>
      <CopyRow value="chmod +x ./setup.sh" lang="ru" prompt />
    </TooltipProvider>,
  )
  return container.firstElementChild as HTMLElement
}

describe('строка со значением и копированием', () => {
  it('высота — та же ступень шкалы, что у кнопки', () => {
    const h = heightOf(row().className)
    expect(h).toBeDefined()
    expect(h).toBe(heightOf(buttonClass()))
  })

  it('высоту не задаёт padding — иначе она совпадёт с соседями случайно', () => {
    const classes = row().className.split(/\s+/)
    expect(classes.filter((c) => /^py-|^p-/.test(c))).toEqual([])
  })

  it('кнопка копирования не растёт на сенсоре — иначе она и распирает строку', () => {
    row()
    // Тач-цель добирается невидимой зоной (правило 13.08.2026), а не ростом кнопки:
    // выросшая до 44px кнопка внутри строки в 32px — ровно исходный дефект.
    expect(screen.getByRole('button').className).not.toMatch(/pointer-coarse:size-11/)
  })

  it('команда видна целиком и прокручивается, а не обрезается', () => {
    const text = row().querySelector('code') as HTMLElement
    expect(text.textContent).toBe('chmod +x ./setup.sh')
    expect(text.className).toMatch(/overflow-x-auto/)
    expect(text.className).not.toMatch(/truncate/)
  })
})

describe('вариант с полем: адрес, который выделяют и копируют руками', () => {
  it('высота та же — поле внутри её не меняет', () => {
    const { container } = render(
      <TooltipProvider delay={0}>
        <CopyRow value="https://setfork.com/mikey/list.git" selectLabel="Адрес" />
      </TooltipProvider>,
    )
    expect(heightOf((container.firstElementChild as HTMLElement).className)).toBe(heightOf(buttonClass()))
  })

  it('у поля есть имя для экранного диктора — без подписи оно безымянно', () => {
    render(
      <TooltipProvider delay={0}>
        <CopyRow value="https://setfork.com/mikey/list.git" selectLabel="Адрес" />
      </TooltipProvider>,
    )
    expect(screen.getByLabelText('Адрес')).toHaveValue('https://setfork.com/mikey/list.git')
  })
})
