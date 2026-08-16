import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DASHBOARD_LISTS, ListsPanel, type ListsPanelItem } from '@/widgets/ListsPanel'

const item = (n: number): ListsPanelItem => ({
  handle: 'miki',
  slug: `list-${n}`,
  title: { en: `List ${n}`, ru: `Список ${n}` },
  avatarUrl: null,
  version: 42,
})

describe('панель списков дашборда', () => {
  it('начинается с семи строк без версий и догружает следующую компактную порцию', async () => {
    const user = userEvent.setup()
    const first = Array.from({ length: DASHBOARD_LISTS }, (_, i) => item(i + 1))
    const next = Array.from({ length: DASHBOARD_LISTS }, (_, i) => item(i + 1 + DASHBOARD_LISTS))
    const loadMore = vi.fn(async () => next)
    const remoteSearch = vi.fn(async () => [])

    render(
      <ListsPanel
        items={first}
        lang="en"
        title="Lists"
        initialLimit={DASHBOARD_LISTS}
        total={500}
        loadMore={loadMore}
        remoteSearch={remoteSearch}
      />,
    )

    expect(DASHBOARD_LISTS).toBe(7)
    expect(screen.getAllByRole('link')).toHaveLength(7)
    expect(screen.queryByText('v42')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Find a list…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `Show more (${DASHBOARD_LISTS})` }))

    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(14))
    expect(loadMore).toHaveBeenCalledWith(7, 7)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show less' }))

    expect(screen.getAllByRole('link')).toHaveLength(7)
    expect(screen.getByRole('button', { name: `Show more (${DASHBOARD_LISTS})` })).toBeInTheDocument()
  })
})
