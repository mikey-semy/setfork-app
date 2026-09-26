import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * «ВЗЯТЬ ЭТОТ» НА ВАРИАНТЕ, КОТОРЫЙ СТРАЖ НЕ ПРИНЯЛ: причина в чате, а не страница ошибки.
 * Модель может вставить в шаг опасную команду или строку, похожую на ключ; раньше
 * исключение фасада уводило на безымянную страницу, и вариант казался потерянным.
 */
const accept = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/features/generation/actions', () => ({
  acceptCandidate: accept,
  answerClarify: vi.fn(),
  refineInChat: vi.fn(),
  regenerateCandidate: vi.fn(),
  setGenerationDetail: vi.fn(),
  setGenerationKind: vi.fn(),
}))

const { GenerationChat } = await import('@/features/generation/GenerationChat')
const { TooltipProvider } = await import('@/shared/ui/Tooltip')

const cand = {
  id: 'c1',
  generationId: 'gen-1',
  idx: 1,
  title: 'Развернуть сервис',
  desc: '',
  summary: '',
  tags: [],
  items: [{ title: 'Шаг', desc: '', command: '', level: 'required', why: '', subtasks: [], refs: [] }],
  provenance: {},
  hint: '',
  createdAt: new Date('2026-09-25T09:00:00.000Z'),
}

describe('чат генерации: отказ стража при «Взять этот»', () => {
  it('причина и шаг — в чате', async () => {
    accept.mockResolvedValueOnce({ refusal: { kind: 'secret', rule: 'github-pat', step: '1' } })
    render(
      <TooltipProvider>
        <GenerationChat
          generationId="gen-1"
          lang="ru"
          candidates={[cand as never]}
          status="done"
          messages={[]}
          listKind="procedure"
          detail="normal"
          avatars={{}}
          gnomeNames={{}}
          repBadges={{}}
        />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getAllByText('Использовать этот')[0])
    await waitFor(() => expect(screen.getByText('Похоже на ключ доступа')).toBeTruthy())
    expect(screen.getByText(/Шаг 1: похоже на ключ GitHub/)).toBeTruthy()
    expect(accept).toHaveBeenCalledWith('gen-1', 'c1')
  })
})
