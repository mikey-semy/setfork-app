import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * РЕГРЕССИЯ (фидбек владельца со скрина): виток сорвался — «Не получилось», и НИ ОДНОЙ кнопки.
 * Ряд действий рисовался только при наличии варианта, а его-то как раз и не было: единственным
 * выходом оставалось написать что-то в поле руками.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/features/generation/actions', () => ({
  acceptCandidate: vi.fn(),
  answerClarify: vi.fn(),
  refineInChat: vi.fn(),
  regenerateCandidate: vi.fn(),
  setGenerationDetail: vi.fn(),
  setGenerationKind: vi.fn(),
}))

const { GenerationChat } = await import('@/features/generation/GenerationChat')
const { serializeFailure } = await import('@/shared/ai/failure')
// Провайдер тултипов живёт в layout — в тесте даём его руками (иначе Radix бросает).
const { TooltipProvider } = await import('@/shared/ui/Tooltip')

const failMessage = {
  id: 'm2',
  attempt: 1,
  kind: 'error' as const,
  who: 'council',
  name: null,
  text: serializeFailure({ code: 'timeout', model: 'openai/gpt-4o-mini', detail: 'AbortError: request timed out' }),
  createdAt: new Date('2026-08-01T09:22:11.000Z'),
}
const userMessage = {
  id: 'm1',
  attempt: 1,
  kind: 'user' as const,
  who: null,
  name: null,
  text: 'Лучшие сайты для изучения китайского',
  createdAt: new Date('2026-08-01T09:20:00.000Z'),
}

const chat = (extra?: Partial<React.ComponentProps<typeof GenerationChat>>) => (
  <TooltipProvider>
    <GenerationChat
      generationId="gen-1"
      lang="ru"
      candidates={[]}
      status="failed"
      messages={[userMessage, failMessage]}
      listKind="procedure"
      detail="normal"
      avatars={{}}
      gnomeNames={{}}
      repBadges={{}}
      {...extra}
    />
  </TooltipProvider>
)

describe('чат генерации: виток сорвался', () => {
  it('повтор доступен кнопкой, а не только текстом в поле', () => {
    render(chat())
    expect(screen.getByText('Ещё раз')).toBeTruthy()
    // Принимать нечего — кнопки выбора варианта в ряду быть не должно.
    expect(screen.queryByText('Использовать этот')).toBeNull()
  })

  it('шесть сорвавшихся витков не съедают право на попытку — потолок про варианты', () => {
    // Раньше потолок упирался в номер витка: семь провалов — и «предел в 6 вариантов» при нуле вариантов.
    const failures = Array.from({ length: 7 }, (_, i) => ({ ...failMessage, id: `f${i}`, attempt: i + 1 }))
    render(chat({ messages: failures }))
    expect(screen.getByText('Ещё раз')).toBeTruthy()
  })

  it('причина рядом с провалом — свёрнута', () => {
    render(chat())
    expect(screen.getByText('Не получилось — попробуй ещё раз.')).toBeTruthy()
    expect(screen.getByText('Подробности')).toBeTruthy()
    expect(screen.queryByText(/AbortError/)).toBeNull()
  })
})
