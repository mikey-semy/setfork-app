import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CatalogRow } from '@/features/catalogs/CatalogRow'
import { FeedCard } from '@/features/library/FeedCard'
import type { FeedItem } from '@/features/library/queries'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { TooltipProvider } from '@/shared/ui/Tooltip'

vi.mock('@/features/library/actions', () => ({
  toggleStar: vi.fn(),
}))

const item: FeedItem = {
  id: 'list-1',
  ownerHandle: 'miki',
  ownerAvatarUrl: null,
  slug: 'long-list',
  title: {
    ru: 'Очень длинный перевод заголовка списка',
    en: 'A very long translated list title',
  },
  desc: { ru: 'Описание', en: 'Description' },
  tags: ['test'],
  version: 4,
  origin: 'authored',
  status: 'draft',
  runsCount: 2,
  forksCount: 3,
  starsCount: 1,
  visibility: 'public',
  verified: true,
  updatedAt: new Date('2026-08-15T10:00:00Z'),
}

function renderFeedCard(overrides: Partial<FeedItem> = {}) {
  return render(
    <TooltipProvider>
      <FeedCard item={{ ...item, ...overrides }} lang="ru" />
    </TooltipProvider>,
  )
}

describe('FeedCard', () => {
  it('держит owner/title в одной строке, а состояние — после версии в метаданных', () => {
    const { container } = renderFeedCard()
    const title = screen.getByTitle('Очень длинный перевод заголовка списка')
    const titleLine = title.parentElement
    const version = screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'v4')
    const status = screen.getByText('Черновик')

    expect(titleLine).toHaveClass('truncate', 'whitespace-nowrap')
    expect(version.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status.closest('div')).toContainElement(screen.getByLabelText('проверен'))
    expect(container.firstElementChild?.firstElementChild).toHaveClass('border-b')
    expect(container.firstElementChild?.lastElementChild).toHaveClass('border-t')
  })

  it('показывает публичность опубликованного списка тем же мета-блоком', () => {
    renderFeedCard({ status: 'published', verified: false })
    expect(screen.getByText('Публичный')).toBeInTheDocument()
  })
})

describe('многострочные карточки Explore', () => {
  it('каталог имеет естественную высоту без кнопочного h-10', () => {
    render(
      <CatalogRow
        lang="ru"
        c={{
          id: 'catalog-1',
          name: 'catalog',
          title: { ru: 'Каталог' },
          desc: { ru: 'Описание каталога' },
          ownerHandle: 'miki',
          ownerAvatarUrl: null,
          listCount: 12,
        }}
      />,
    )
    const link = screen.getByRole('link', { name: /Каталог/ })
    expect(link).toHaveClass('p-3')
    expect(link).not.toHaveClass('h-10')
  })

  it('человек в Trending имеет естественную высоту без кнопочного h-10', () => {
    render(
      <PeopleResults
        lang="ru"
        people={[
          {
            handle: 'analysis-expert',
            name: 'Data Analyst',
            avatarUrl: null,
            bio: 'Длинное описание эксперта, которое занимает несколько строк.',
            listsCount: 3,
            followersCount: 4,
          },
        ]}
      />,
    )
    const link = screen.getByRole('link', { name: /Data Analyst/ })
    expect(link).toHaveClass('p-3')
    expect(link).not.toHaveClass('h-10')
  })
})
