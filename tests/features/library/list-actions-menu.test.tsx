import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/library/actions/versions', () => ({ publishList: vi.fn(async () => {}) }))
vi.mock('@/features/library/actions/ai', () => ({ translateList: vi.fn(async () => ({})) }))
vi.mock('@/shared/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))

const { ListActionsMenu } = await import('@/features/library/ListActionsMenu')

const props = {
  base: '/miki/draft',
  isOwner: true,
  templateId: 'draft-1',
  lang: 'en' as const,
  canTranslate: false,
  canPublish: true,
  targetLang: 'en' as const,
}

describe('одноразовая подсказка публикации', () => {
  beforeEach(() => window.localStorage.clear())

  it('объясняет точку, лопает её при открытии и запоминает просмотр', async () => {
    const user = userEvent.setup()
    const first = render(<ListActionsMenu {...props} />)
    const trigger = await screen.findByRole('button', { name: 'You can publish this list' })
    const dot = await waitFor(() => {
      const node = document.querySelector('[data-publish-hint]') as HTMLElement | null
      expect(node).toBeInTheDocument()
      return node as HTMLElement
    })

    await user.click(trigger)

    expect(dot).toHaveClass('sf-hint-burst')
    expect(window.localStorage.getItem('sf:publish-hint:draft-1')).toBe('1')

    await waitFor(() => expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument())

    first.unmount()
    render(<ListActionsMenu {...props} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument())
    expect(document.querySelector('[data-publish-hint]')).not.toBeInTheDocument()
  })
})
