import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * В ЛЕНТЕ ВИДНО, КТО ОТВЕТИЛ.
 *
 * ⚠️ Реплики мастеров отличались только аватаркой — а у большинства мастеров своей
 * картинки нет, и все они показывают общую заглушку. Когда мастер передаёт вопрос
 * коллеге (это настоящий механизм, а не оборот речи), в беседе молча появляется второй
 * голос, и понять, кто пришёл, не по чему. Владелец на этом и споткнулся: выбрал одного
 * собеседника, а ответ пришёл будто от другого.
 */
vi.mock('@/features/dig/chat-actions', () => ({
  digChatAsk: vi.fn(),
  thankGnome: vi.fn(),
  getDigChatHistory: vi.fn(),
}))

const { TooltipProvider } = await import('@/shared/ui/Tooltip')
const { getDigChatHistory } = await import('@/features/dig/chat-actions')
const { DigChatHost, DIG_CHAT_EVENT } = await import('@/features/dig/DigChat')

const gnomes = [
  { id: 'tester', name: 'Глоин', guild: 'Гильдия кодеров' },
  { id: 'chef', name: 'Фьялар', guild: 'Гильдия поваров' },
]

const open = () =>
  window.dispatchEvent(new CustomEvent(DIG_CHAT_EVENT, { detail: { templateId: 't-1', stepN: 1, stepTitle: 'Шаг 1' } }))

const show = async (messages: Array<{ role: 'user' | 'gnome'; who?: string; text: string }>) => {
  vi.mocked(getDigChatHistory).mockResolvedValue({ ok: true, messages })
  render(
    <TooltipProvider delay={0}>
      <DigChatHost gnomes={gnomes} lang="ru" />
    </TooltipProvider>,
  )
  open()
  await waitFor(() => expect(screen.getByText(messages[messages.length - 1].text)).toBeTruthy())
}

describe('подпись отвечавшего', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollTo ??= () => {}
  })

  it('ответ подписан именем мастера и его цехом', async () => {
    await show([{ role: 'gnome', who: 'tester', text: 'пирамидой тестов' }])
    expect(screen.getAllByText(/Глоин · Гильдия кодеров/).length, 'кто ответил — не написано нигде').toBeGreaterThan(0)
  })

  it('мастер позвал коллегу — в ленте два РАЗНЫХ голоса', async () => {
    await show([
      { role: 'user', who: undefined, text: 'а если про соус' },
      { role: 'gnome', who: 'tester', text: 'это не моё ремесло, зову Фьялара' },
      { role: 'gnome', who: 'chef', text: 'соус держат на слабом огне' },
    ])
    expect(screen.getAllByText(/Глоин/).length, 'передавший вопрос не назван').toBeGreaterThan(0)
    expect(screen.getAllByText(/Фьялар · Гильдия поваров/).length, 'пришедший коллега не назван — голос ниоткуда').toBeGreaterThan(0)
  })

  // ⚠️ Обратная сторона: вопросы человека подписывать нечем и незачем — это его реплики,
  // и чужое имя над ними означало бы, что мастер говорит за него.
  it('над репликой человека имени мастера нет', async () => {
    await show([{ role: 'user', text: 'как проверить' }])
    expect(screen.queryByText(/Глоин/), 'реплика человека подписана мастером').toBeNull()
  })
})
