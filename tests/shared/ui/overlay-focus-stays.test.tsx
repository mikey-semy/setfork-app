import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'

/**
 * ⚠️ ФОКУС НЕ УХОДИТ ИЗ ПОЛЯ, ПОКА ЧЕЛОВЕК ПЕЧАТАЕТ.
 *
 * Ловушка фокуса стояла в эффекте с `onClose` в зависимостях, а вызывающие передают его
 * стрелкой прямо в разметке — новой функцией на каждый рендер. Значит на каждый
 * набранный символ эффект перезапускался: уборка возвращала фокус на кнопку, открывшую
 * окно, и эффект уводил его обратно в поле.
 *
 * На мыши это невидимо. На телефоне возврат фокуса сворачивает клавиатуру — владелец
 * 02.09.2026: «невозможно ввести слова — каждая новая буква сворачивает клавиатуру».
 */
/**
 * Порядок здесь ВОСПРОИЗВОДИТ ЖИЗНЬ, и это не педантизм: уборка эффекта возвращает фокус
 * туда, где он был В МОМЕНТ ОТКРЫТИЯ. Открой мы окно программно, «тем местом» оказалось
 * бы само поле, и возврат фокуса в него ничего бы не изменил — тест был бы зелёным при
 * сломанном коде. Поэтому окно открывается НАЖАТИЕМ на кнопку, как у человека.
 */
function Harness() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        открыть
      </button>
      {/* onClose — стрелкой в разметке: ровно так его передают все вызывающие. */}
      <OverlayPanel open={open} onClose={() => setOpen(false)} title="Поиск" closeLabel="Закрыть" align="top" width={0} bare>
        <input aria-label="запрос" value={q} onChange={(e) => setQ(e.target.value)} />
      </OverlayPanel>
    </>
  )
}

describe('окно поиска', () => {
  it('оставляет фокус в поле на каждой букве', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'открыть' })
    opener.focus()
    fireEvent.click(opener)

    const field = screen.getByLabelText('запрос') as HTMLInputElement
    field.focus()

    for (const ch of 'гном') {
      fireEvent.change(field, { target: { value: field.value + ch } })
      // ⚠️ Проверяем ПОСЛЕ КАЖДОГО символа: дефект проявляется на перерисовке, а не в конце.
      expect(document.activeElement, `после «${ch}» фокус ушёл из поля на ${document.activeElement?.textContent}`).toBe(field)
    }
    expect(field.value).toBe('гном')
  })
})
