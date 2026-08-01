import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FailureNote } from '@/features/generation/FailureNote'
import { serializeFailure } from '@/shared/ai/failure'

/**
 * Причина провала: человеку — свёрнута, но доступна.
 *
 * Фидбек владельца со скрина: «Не получилось» и всё — ни повтора, ни причины. Тесты держат
 * договор: по умолчанию техники на экране нет, по клику она полная и пригодна к пересылке,
 * а старые витки (реплика ошибки писалась пустой) не рисуют пустую раскрывашку.
 */
describe('FailureNote', () => {
  const raw = serializeFailure({ code: 'invalid', model: 'openai/gpt-4o-mini', detail: 'Sorry, I cannot help with that.' })
  const at = new Date('2026-08-01T09:22:11.000Z')

  it('свёрнут: причина на экране не мозолит глаза', () => {
    render(<FailureNote raw={raw} generationId="gen-1" attempt={2} at={at} lang="ru" />)
    expect(screen.getByText('Подробности')).toBeTruthy()
    expect(screen.queryByText(/Sorry, I cannot help/)).toBeNull()
  })

  it('раскрыт: причина, модель, виток и деталь — всё, что нужно переслать', () => {
    render(<FailureNote raw={raw} generationId="gen-1" attempt={2} at={at} lang="ru" />)
    fireEvent.click(screen.getByText('Подробности'))

    const report = screen.getByText(/SetFork/).textContent ?? ''
    expect(report).toContain('Модель ответила, но не списком (invalid)')
    expect(report).toContain('openai/gpt-4o-mini')
    expect(report).toContain('gen-1')
    expect(report).toContain('виток 2')
    expect(report).toContain('Sorry, I cannot help with that.')
  })

  it('старый виток без причины — строки «Подробности» нет вовсе', () => {
    const { container } = render(<FailureNote raw="" generationId="gen-1" attempt={1} at={at} lang="ru" />)
    expect(container.innerHTML).toBe('')
  })
})
