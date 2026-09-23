import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserHandleInput } from '@/shared/ui/UserHandleInput'

/**
 * ПОЛЕ НИКА СОАВТОРА: «@» СНИМАЕТСЯ САМ, ПОДСКАЗКА ЗАПОЛНЯЕТ ПОЛЕ.
 *
 * Жалоба владельца (мобильный, настройки списка → Соавторы): набираешь «@» — ничего не
 * происходит, людей не ищет. Путь человека здесь ровно такой: набрал «@ma», увидел
 * подсказку, ткнул в человека — в поле его ник, форма уйдёт с ним.
 *
 * Подменена только сеть (`fetch`) — внешнее. Правило снятия «@» и выбор — настоящие.
 */

const people = [
  { handle: 'mark', avatarUrl: null },
  { handle: 'mary', avatarUrl: null },
]

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(people), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  render(
    <form aria-label="collab">
      <UserHandleInput name="handle" placeholder="ник" />
    </form>,
  )
  return screen.getByRole('combobox') as HTMLInputElement
}

describe('UserHandleInput', () => {
  it('набранный «@» не попадает в значение, а поиск идёт без него', async () => {
    const field = setup()
    await userEvent.type(field, '@ma')
    expect(field.value).toBe('ma')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.at(-1)).toBe('/api/users/search?q=ma')
    expect(urls.every((u) => !u.includes('%40'))).toBe(true)
  })

  it('выбор из подсказки заполняет поле, и форма отправит этот ник', async () => {
    const field = setup()
    await userEvent.type(field, 'ma')
    const option = await screen.findByRole('option', { name: '@mary' })
    await userEvent.click(option)
    expect(field.value).toBe('mary')
    expect(new FormData(field.form!).get('handle')).toBe('mary')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('Enter при открытой подсказке выбирает человека, а не отправляет форму', async () => {
    const field = setup()
    const submit = vi.fn((e: Event) => e.preventDefault())
    field.form!.addEventListener('submit', submit)
    await userEvent.type(field, 'ma')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(field.value).toBe('mary')
    expect(submit).not.toHaveBeenCalled()
  })
})
