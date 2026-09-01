import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * СБОЙ ЗАГРУЗКИ БЕСЕДЫ — НЕ ПУСТАЯ БЕСЕДА.
 *
 * Владелец: «спросил в чате, метка что спрашивал осталась, сообщение видел, а потом
 * пропало — истории нет». История была жива: оборвалась связь (VPN), а интерфейс
 * промолчал и показал чат без единой реплики. Три глушителя подряд — молчаливый catch
 * на записи, на чтении и на клиенте — превращали любой сбой в «ничего и не было».
 */
vi.mock('@/features/dig/chat-actions', () => ({
  digChatAsk: vi.fn(),
  thankGnome: vi.fn(),
  getDigChatHistory: vi.fn(),
}))

const { TooltipProvider } = await import('@/shared/ui/Tooltip')
const { getDigChatHistory, digChatAsk } = await import('@/features/dig/chat-actions')
const { DigChatHost, DIG_CHAT_EVENT } = await import('@/features/dig/DigChat')

const openStep = (stepN = 3) =>
  window.dispatchEvent(
    new CustomEvent(DIG_CHAT_EVENT, { detail: { templateId: 't-1', stepN, stepTitle: `Шаг ${stepN}` } }),
  )

describe('история беседы кирки', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom не умеет прокрутку, а панель чата листает себя к последней реплике.
    Element.prototype.scrollTo ??= () => {}
  })

  it('сбой загрузки назван причиной, а не показан пустым чатом', async () => {
    vi.mocked(getDigChatHistory).mockResolvedValue({ ok: false })
    render(
      <TooltipProvider delay={0}>
        <DigChatHost gnomes={[{ id: 'generalist', name: 'Мастер', guild: '' }]} lang="ru" />
      </TooltipProvider>,
    )
    openStep()

    expect(await screen.findByText('Не удалось загрузить беседу')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('повтор перечитывает беседу — не требуя перезагрузки страницы', async () => {
    const user = userEvent.setup()
    vi.mocked(getDigChatHistory)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, messages: [{ role: 'user', text: 'что это такое?' }] })
    render(
      <TooltipProvider delay={0}>
        <DigChatHost gnomes={[{ id: 'generalist', name: 'Мастер', guild: '' }]} lang="ru" />
      </TooltipProvider>,
    )
    openStep()

    await user.click(await screen.findByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('что это такое?')).toBeInTheDocument()
    expect(screen.queryByText('Не удалось загрузить беседу')).toBeNull()
  })

  it('удавшийся повтор не выбрасывает то, что успели написать', async () => {
    const user = userEvent.setup()
    vi.mocked(getDigChatHistory)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, messages: [{ role: 'user', text: 'старый вопрос' }] })
    vi.mocked(digChatAsk).mockResolvedValue({ replies: [{ who: 'generalist', name: 'Мастер', text: 'ответ гнома', followups: [] }] })
    render(
      <TooltipProvider delay={0}>
        <DigChatHost gnomes={[{ id: 'generalist', name: 'Мастер', guild: '' }]} lang="ru" />
      </TooltipProvider>,
    )
    openStep()
    await screen.findByRole('button', { name: 'Повторить' })

    // Пока загрузка не удалась, спрашивать не запрещено.
    await user.type(screen.getByRole('textbox'), 'новый вопрос')
    await user.keyboard('{Enter}')
    await screen.findByText('ответ гнома')

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    // Обе стороны на месте: и восстановленная беседа, и написанное только что.
    expect(await screen.findByText('старый вопрос')).toBeInTheDocument()
    expect(screen.getByText('ответ гнома')).toBeInTheDocument()
  })

  it('отказ обогнавшего запроса не помечает сбоем уже загруженный шаг', async () => {
    let failA: (v: { ok: false }) => void = () => {}
    vi.mocked(getDigChatHistory)
      .mockImplementationOnce(() => new Promise((r) => (failA = r as typeof failA)))
      .mockResolvedValueOnce({ ok: true, messages: [{ role: 'user', text: 'беседа шага B' }] })
    render(
      <TooltipProvider delay={0}>
        <DigChatHost gnomes={[{ id: 'generalist', name: 'Мастер', guild: '' }]} lang="ru" />
      </TooltipProvider>,
    )
    openStep() // шаг 3 — ответ ещё не пришёл
    openStep(7) // человек ушёл на шаг 7, тот загрузился
    expect(await screen.findByText('беседа шага B')).toBeInTheDocument()

    await act(async () => {
      failA({ ok: false })
      await Promise.resolve()
    })

    expect(screen.queryByText('Не удалось загрузить беседу')).toBeNull()
    expect(screen.getByText('беседа шага B')).toBeInTheDocument()
  })

  it('повтор принадлежит ошибке истории, а не ошибке вопроса', async () => {
    const user = userEvent.setup()
    vi.mocked(getDigChatHistory).mockResolvedValue({ ok: false })
    vi.mocked(digChatAsk).mockResolvedValue({ error: 'quota' })
    render(
      <TooltipProvider delay={0}>
        <DigChatHost gnomes={[{ id: 'generalist', name: 'Мастер', guild: '' }]} lang="ru" />
      </TooltipProvider>,
    )
    openStep()
    await screen.findByRole('button', { name: 'Повторить' })

    await user.type(screen.getByRole('textbox'), 'вопрос')
    await user.keyboard('{Enter}')

    // Показана ошибка квоты — повторять ей нечего: кнопка перечитала бы беседу.
    await waitFor(() => expect(screen.queryByText('Не удалось загрузить беседу')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull()
  })

  it('пустая беседа остаётся пустой и ни на что не жалуется', async () => {
    vi.mocked(getDigChatHistory).mockResolvedValue({ ok: true, messages: [] })
    render(
      <TooltipProvider delay={0}>
        <DigChatHost gnomes={[{ id: 'generalist', name: 'Мастер', guild: '' }]} lang="ru" />
      </TooltipProvider>,
    )
    openStep()

    await waitFor(() => expect(getDigChatHistory).toHaveBeenCalled())
    expect(screen.queryByText('Не удалось загрузить беседу')).toBeNull()
  })
})
