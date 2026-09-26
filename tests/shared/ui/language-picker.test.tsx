import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LanguagePicker } from '@/shared/ui/LanguagePicker'

/**
 * ВЫБОР ЯЗЫКА СОДЕРЖИМОГО (ADR-0030): частые — сверху, остальные — поиском в той же панели.
 * Найти язык можно по имени на языке интерфейса, по самоназванию и по коду.
 */
const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /Не задан|Как интерфейс|белорус/i }))

describe('LanguagePicker', () => {
  it('частые — отдельной группой сверху; белорусский находится и по самоназванию, и по коду', async () => {
    const user = userEvent.setup()
    render(<LanguagePicker lang="ru" />)
    await open(user)
    expect(screen.getByText('Частые')).toBeTruthy()
    const search = screen.getByPlaceholderText('Найти язык')
    await user.type(search, 'беларуская')
    expect(screen.getByText(/белорусский/i)).toBeTruthy()
    await user.clear(search)
    await user.type(search, 'kk')
    expect(screen.getByText(/казахский/i)).toBeTruthy()
  })

  it('язык не из частых — поиском («другой»)', async () => {
    const user = userEvent.setup()
    render(<LanguagePicker lang="ru" />)
    await open(user)
    await user.type(screen.getByPlaceholderText('Найти язык'), 'грузин')
    expect(screen.getByText(/грузинский/i)).toBeTruthy()
    expect(screen.queryByText('Частые')).toBeNull()
  })

  it('выбор — в скрытое поле формы и наружу', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<LanguagePicker lang="ru" name="sourceLang" onChange={onChange} />)
    await open(user)
    await user.type(screen.getByPlaceholderText('Найти язык'), 'белорус')
    await user.click(screen.getByText(/белорусский/i))
    expect(onChange).toHaveBeenCalledWith('be')
    expect((container.querySelector('input[name="sourceLang"]') as HTMLInputElement).value).toBe('be')
  })

  it('пустой выбор — только если его предложили («как интерфейс»)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LanguagePicker lang="ru" value="be" onChange={onChange} noneLabel="Как интерфейс" />)
    await user.click(screen.getByRole('button', { name: /белорус/i }))
    await user.click(within(document.body).getAllByText('Как интерфейс').at(-1)!)
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
