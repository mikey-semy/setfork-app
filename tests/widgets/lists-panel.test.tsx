import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ListsPanel, type ListsPanelItem } from '@/widgets/ListsPanel'
import { DASHBOARD_LISTS } from '@/shared/lib/paging'

const item = (n: number): ListsPanelItem => ({
  handle: 'miki',
  slug: `list-${n}`,
  title: { en: `List ${n}`, ru: `Список ${n}` },
  avatarUrl: null,
  version: 42,
})

const page = (n: number) => Array.from({ length: DASHBOARD_LISTS }, (_, i) => item((n - 1) * DASHBOARD_LISTS + i + 1))

describe('панель списков дашборда', () => {
  it('листает страницами по семь строк и не копит их на экране', async () => {
    const user = userEvent.setup()
    const loadPage = vi.fn(async (offset: number) => page(offset / DASHBOARD_LISTS + 1))
    const remoteSearch = vi.fn(async () => [])

    render(
      <ListsPanel
        items={page(1)}
        lang="en"
        title="Lists"
        initialLimit={DASHBOARD_LISTS}
        total={500}
        loadPage={loadPage}
        remoteSearch={remoteSearch}
      />,
    )

    expect(DASHBOARD_LISTS).toBe(7)
    expect(screen.getAllByRole('link')).toHaveLength(7)
    expect(screen.queryByText('v42')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Find a list…')).toBeInTheDocument()
    // 500 списков по семь — 72 страницы; на первой «назад» вести некуда.
    expect(screen.getByText('1 / 72')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(screen.getByText('2 / 72')).toBeInTheDocument())
    expect(loadPage).toHaveBeenCalledWith(7, 7)
    // ГЛАВНОЕ: страница ЗАМЕНИЛА показанное, а не дописалась вниз.
    expect(screen.getAllByRole('link')).toHaveLength(7)
    expect(screen.getByText('List 8')).toBeInTheDocument()
    expect(screen.queryByText('List 1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous page' }))

    // Возврат на первую страницу берёт то, что уже пришло с сервера, — без запроса.
    expect(screen.getByText('1 / 72')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(7)
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('не листает, когда всё умещается на одной странице', () => {
    render(
      <ListsPanel
        items={page(1).slice(0, 3)}
        lang="en"
        title="Lists"
        initialLimit={DASHBOARD_LISTS}
        total={3}
        loadPage={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })

  it('сообщает об ошибке страницы и остаётся на текущей', async () => {
    const user = userEvent.setup()
    const loadPage = vi.fn(async () => {
      throw new Error('offline')
    })

    render(
      <ListsPanel items={page(1)} lang="en" title="Lists" initialLimit={DASHBOARD_LISTS} total={500} loadPage={loadPage} />,
    )

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(screen.getByText('Could not load. Try again.')).toBeInTheDocument())
    expect(screen.getByText('1 / 72')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(7)
  })
})

describe('страница, которой не стало', () => {
  it('не запирает панель, когда списков стало меньше, чем было страниц', async () => {
    const user = userEvent.setup()
    const loadPage = vi.fn(async (offset: number) => page(offset / DASHBOARD_LISTS + 1))
    const props = { lang: 'en' as const, title: 'Lists', initialLimit: DASHBOARD_LISTS, loadPage }

    // Ушли на четвёртую страницу из семидесяти двух...
    const { rerender } = render(<ListsPanel {...props} items={page(1)} total={500} />)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('4 / 72')).toBeInTheDocument())

    // ...а пока мы там стояли, библиотека уменьшилась до полутора страниц.
    rerender(<ListsPanel {...props} items={page(1)} total={10} />)

    // Обе стрелки мёртвыми быть не должны: это тупик, из которого выходят перезагрузкой.
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // И показаны строки существующей страницы, а не осиротевшей четвёртой.
    expect(screen.getByText('List 1')).toBeInTheDocument()
  })
})

describe('доступность панели', () => {
  it('неудачную загрузку страницы объявляют, а не показывают молча', async () => {
    const user = userEvent.setup()
    const loadPage = vi.fn(async () => {
      throw new Error('offline')
    })
    render(<ListsPanel items={page(1)} lang="en" title="Lists" initialLimit={DASHBOARD_LISTS} total={500} loadPage={loadPage} />)

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    // Без role="alert" живая область листалки вернёт то же «Page 1 / 72», что читалось до
    // нажатия, — выйдет, будто ничего и не нажимали.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load. Try again.'))
  })

  it('список строк — названный ориентир: рядом стоит листалка, тоже nav', () => {
    render(<ListsPanel items={page(1)} lang="en" title="My lists" initialLimit={DASHBOARD_LISTS} total={500} loadPage={vi.fn()} />)
    // Два безымянных «navigation» в списке ориентиров скринридера неразличимы.
    expect(screen.getByRole('navigation', { name: 'My lists' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation').every((n) => n.getAttribute('aria-label'))).toBe(true)
  })
})
