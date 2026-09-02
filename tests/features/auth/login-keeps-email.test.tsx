import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'

/**
 * ОТКАЗ ВХОДА НЕ СТИРАЕТ ПОЧТУ, НО СТИРАЕТ ПАРОЛЬ.
 *
 * React сбрасывает неуправляемые поля после отправки, поэтому при неверном пароле форма
 * входа оказывалась пустой целиком — «устал заново вводить» (владелец, 02.09.2026).
 * Пароль при этом возвращать нельзя: так у GitHub, и оставленный на экране пароль — это
 * вход в одно нажатие на чужом устройстве.
 *
 * Проверяем сам приём, а не форму целиком: форма зовёт серверное действие, а правило
 * живёт в обёртке и применяется ею одинаково на входе, регистрации и смене пароля.
 */
function Form({ refused, skip }: { refused: boolean; skip?: readonly string[] }) {
  const { formRef, onSubmit } = useKeepFormValues(refused, false, skip ? { skip } : undefined)
  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <input name="email" defaultValue="" aria-label="почта" />
      <input name="password" type="password" defaultValue="" aria-label="пароль" />
      <button type="submit">войти</button>
    </form>
  )
}

/** Отправка со сбросом полей — ровно то, что делает React с `<form action={…}>`. */
const submitAndReset = (form: HTMLFormElement) => {
  fireEvent.submit(form)
  form.reset()
}

describe('набранное при отказе входа', () => {
  it('почта возвращается, пароль — нет', async () => {
    const { rerender } = render(<Form refused={false} skip={['password']} />)
    const email = screen.getByLabelText('почта') as HTMLInputElement
    const password = screen.getByLabelText('пароль') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'miki@example.com' } })
    fireEvent.change(password, { target: { value: 'nevernyy-parol' } })

    submitAndReset(email.form!)
    rerender(<Form refused skip={['password']} />)

    await waitFor(() => expect(email.value).toBe('miki@example.com'))
    expect(password.value, 'пароль обязан остаться пустым').toBe('')
  })

  it('без исключений возвращается всё — приём сам по себе рабочий', async () => {
    const { rerender } = render(<Form refused={false} />)
    const password = screen.getByLabelText('пароль') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'nevernyy-parol' } })

    submitAndReset(password.form!)
    rerender(<Form refused />)

    // ⚠️ Этот случай показывает, что пустой пароль выше — заслуга исключения, а не того,
    // что приём вообще не работает с полями типа password.
    await waitFor(() => expect(password.value).toBe('nevernyy-parol'))
  })
})
