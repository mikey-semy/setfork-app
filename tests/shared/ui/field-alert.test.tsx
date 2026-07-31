import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from '@/shared/ui/Alert'
import { Field } from '@/shared/ui/Field'
import { Input } from '@/shared/ui/input'

/**
 * АНАТОМИЯ СТРОКИ ФОРМЫ ОДНА НА ВСЁ ПРИЛОЖЕНИЕ (Ф1 трека ui-system).
 *
 * До Field подпись поля жила в 14 локальных константах и дрейфовала
 * (font-semibold/medium, 12.5/11.5px), а ошибка показывалась тремя
 * несовместимыми способами. Тесты держат контракт примитива: подпись связана
 * с контролом (клик фокусирует), ошибка и подсказка рендерятся, баннер Alert
 * объявляет себя ассистивным технологиям.
 */

describe('Field', () => {
  it('без htmlFor оборачивает контрол в label — подпись связана с полем', () => {
    render(
      <Field label="Имя">
        <Input defaultValue="" />
      </Field>,
    )
    // getByLabelText находит input ТОЛЬКО если связь label↔контрол есть.
    expect(screen.getByLabelText('Имя')).toBeInstanceOf(HTMLInputElement)
  })

  it('с htmlFor связывает через id — для групп из нескольких контролов', () => {
    render(
      <Field label="Порог" htmlFor="thr">
        <Input id="thr" defaultValue="5" />
        <Input aria-label="второй" defaultValue="10" />
      </Field>,
    )
    expect((screen.getByLabelText('Порог') as HTMLInputElement).value).toBe('5')
  })

  it('hint и error связаны с контролом через aria-describedby, ошибка — role=alert', () => {
    render(
      <Field label="Поле" hint="как заполнять" error="не так заполнил">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Поле')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toHaveLength(2)
    const texts = ids.map((id) => document.getElementById(id)?.textContent)
    expect(texts).toContain('как заполнять')
    expect(texts).toContain('не так заполнил')
    expect(screen.getByRole('alert').textContent).toBe('не так заполнил')
  })

  it('hint и error рендерятся, пустые — нет', () => {
    const { container, rerender } = render(
      <Field label="Поле" hint="подсказка" error="ошибка">
        <Input />
      </Field>,
    )
    expect(screen.getByText('подсказка')).toBeDefined()
    expect(screen.getByText('ошибка')).toBeDefined()
    rerender(
      <Field label="Поле" hint="" error="">
        <Input />
      </Field>,
    )
    expect(container.querySelectorAll('span')).toHaveLength(1) // только подпись
  })
})

describe('Alert', () => {
  it('danger объявляется как role=alert, остальные — status', () => {
    render(<Alert variant="danger">беда</Alert>)
    expect(screen.getByRole('alert').textContent).toContain('беда')
    render(<Alert variant="ok">готово</Alert>)
    expect(screen.getByRole('status').textContent).toContain('готово')
  })
})
