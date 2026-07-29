import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelSelect } from '@/features/admin/ModelSelect'
import { withSavedOption } from '@/features/admin/model-options'

/**
 * РЕГРЕССИЯ: «выбор моделей с ценами откатили».
 *
 * Никакого отката не было — при пустом каталоге поле подменялось голым текстовым вводом, и
 * связка выглядела как удалённая. Пустой каталог случается легко (сеть до провайдера, HTTP-код,
 * нет ключа), поэтому тесты фиксируют ровно то, что должно пережить любой такой сбой:
 * виджет остаётся селектом, сохранённая модель не исчезает, id можно ввести руками.
 */
describe('ModelSelect: каталог пуст', () => {
  const hidden = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`input[name="${name}"][type="hidden"]`)

  it('пустой список опций → это по-прежнему селект (кнопка-триггер), а не текстовое поле', () => {
    const { container } = render(<ModelSelect name="chatModel" defaultValue="anthropic/claude-3.5-haiku" options={[]} allowCustom />)

    expect(screen.getByRole('button')).toBeTruthy()
    // Единственный input — скрытый носитель значения формы; видимого текстового поля нет.
    expect(container.querySelector('input[type="text"]')).toBeNull()
    expect(hidden(container, 'chatModel')?.value).toBe('anthropic/claude-3.5-haiku')
  })

  it('сохранённая модель показана в триггере, даже когда каталога нет', () => {
    render(<ModelSelect name="chatModel" defaultValue="anthropic/claude-3.5-haiku" options={[]} allowCustom />)
    expect(screen.getByRole('button').textContent).toContain('anthropic/claude-3.5-haiku')
  })

  it('id можно ввести руками прямо в поиске → значение уходит в форму', () => {
    const { container } = render(<ModelSelect name="chatModel" defaultValue="" options={[]} allowCustom customHint="Использовать" />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Поиск модели…'), { target: { value: 'openai/gpt-4o-mini' } })

    const custom = screen.getByText('openai/gpt-4o-mini')
    fireEvent.click(custom)
    expect(hidden(container, 'chatModel')?.value).toBe('openai/gpt-4o-mini')
  })

  it('без allowCustom свободный ввод не предлагается (обычный каталог не замусоривается)', () => {
    render(<ModelSelect name="chatModel" defaultValue="" options={[{ value: 'a/b', id: 'a/b' }]} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Поиск модели…'), { target: { value: 'zzz/nope' } })

    expect(screen.queryByText('zzz/nope')).toBeNull()
    expect(screen.getByText('Ничего не найдено')).toBeTruthy()
  })

  it('модель из каталога не дублируется строкой свободного ввода', () => {
    render(<ModelSelect name="chatModel" defaultValue="" options={[{ value: 'a/b', id: 'a/b' }]} allowCustom customHint="Использовать" />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Поиск модели…'), { target: { value: 'a/b' } })

    expect(screen.queryByText('Использовать')).toBeNull()
    expect(screen.getAllByText('a/b')).toHaveLength(1)
  })
})

describe('withSavedOption: сохранённая модель не теряется', () => {
  it('каталог пуст → сохранённая модель всё равно опция', () => {
    expect(withSavedOption([], 'gpt://folder/yandexgpt')).toEqual([{ value: 'gpt://folder/yandexgpt', id: 'gpt://folder/yandexgpt' }])
  })

  it('модель уже в каталоге → без дубля', () => {
    const opts = [{ value: 'a/b', id: 'a/b', price: '$1.00' }]
    expect(withSavedOption(opts, 'a/b')).toEqual(opts)
  })

  it('модель не сохранена → список не трогаем', () => {
    const opts = [{ value: 'a/b', id: 'a/b' }]
    expect(withSavedOption(opts, '')).toEqual(opts)
  })
})
