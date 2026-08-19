import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProfileLists } from '@/app/[handle]/ProfileLists'
import { ListsToolbar } from '@/features/profile/ListsToolbar'
import { SelectionProvider } from '@/features/library/bulk/selection'
import { SelectionToggle } from '@/features/library/bulk/SelectionToggle'
import { SelectableCard } from '@/features/library/bulk/SelectableCard'

const push = vi.fn()
/** Адрес, «на котором стоит» панель: тесты подменяют его, когда важен номер страницы. */
let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  usePathname: () => '/alice',
  useRouter: () => ({ push }),
  useSearchParams: () => currentParams,
}))

const emptyProps = {
  handle: 'alice',
  lang: 'en' as const,
  tab: 'lists' as const,
  isOwner: false,
  viewer: null,
  total: 0,
  allIds: [],
  pageItems: [],
  page: 1,
  totalPages: 1,
  pageHref: () => '/alice?tab=lists',
  starFolders: [],
  fsort: 'name' as const,
  folder: undefined,
  rawQuery: '',
  sort: 'recent' as const,
  listType: 'all' as const,
  catalogs: [],
  catalogFilter: undefined,
  unfiledCount: 0,
}

describe('панель списков профиля', () => {
  it('не показывает бесполезные поиск и фильтры на действительно пустой вкладке', () => {
    render(<ProfileLists {...emptyProps} unfilteredItemsCount={0} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('No lists yet.')).toBeInTheDocument()
  })

  it('оставляет панель, если выдачу обнулили фильтры, а списки у профиля есть', () => {
    render(<ProfileLists {...emptyProps} unfilteredItemsCount={1} rawQuery="nothing" />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('оформляет Starred теми же контролами и той же высотой, что Lists', () => {
    render(
      <ListsToolbar
        tab="starred"
        lang="en"
        isOwner={false}
        q=""
        type="all"
        sort="recent"
      />,
    )

    const search = screen.getByRole('textbox')
    const searchBox = search.parentElement?.parentElement
    const selects = screen.getAllByRole('combobox')

    expect(search).toHaveAttribute('placeholder', 'Search stars…')
    expect(searchBox).toHaveClass('h-8')
    expect(searchBox).not.toHaveClass('pointer-coarse:min-h-11')
    expect(selects).toHaveLength(1)
    expect(selects[0]).toHaveClass('h-8')
    expect(screen.queryByText('All types')).not.toBeInTheDocument()
  })

  it('держит Select в тулбаре и превращает его в явную отмену режима', async () => {
    const user = userEvent.setup()
    render(
      <SelectionProvider>
        <ListsToolbar tab="lists" lang="en" isOwner q="" type="all" sort="recent" actions={<SelectionToggle lang="en" />} />
        <SelectableCard id="one" label="Example list">
          <div>Example list</div>
        </SelectableCard>
      </SelectionProvider>,
    )

    const create = screen.getByRole('link', { name: 'New' })
    const select = screen.getByRole('button', { name: 'Select' })
    expect(create.parentElement).toBe(select.parentElement)
    expect(create).toHaveClass('bg-primary', 'text-primary-fg')
    expect(select).toHaveAttribute('aria-pressed', 'false')

    await user.click(select)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('checkbox', { name: 'Example list' })).toBeInTheDocument()

    await user.click(cancel)
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('checkbox', { name: 'Example list' })).not.toBeInTheDocument()
  })
})

describe('смена отбора и номер страницы', () => {
  it('смена отбора возвращает на ПЕРВУЮ страницу', async () => {
    // Номер страницы осмыслен только внутри одного отбора: пятой страницы «звёзд по
    // имени» может не быть у «звёзд по дате», и остаться на ней значило бы показать
    // пустоту вместо выдачи. Правило держится одной строкой в панели, поэтому и
    // закреплено проверкой.
    currentParams = new URLSearchParams('tab=lists&sort=recent&page=5')
    push.mockClear()
    const user = userEvent.setup()
    render(<ListsToolbar tab="lists" lang="en" isOwner={false} q="" type="all" sort="recent" />)

    // Через поиск, а не через выпадающий список: оба идут одним и тем же `navigate`,
    // но поле — нативное, и проверка не зависит от внутренностей Select.
    await user.type(screen.getByRole('textbox'), 'докер{Enter}')

    expect(push).toHaveBeenCalledTimes(1)
    const url = new URL(push.mock.calls[0][0] as string, 'https://example.test')
    expect(url.searchParams.get('page')).toBeNull()
    // Остальной отбор при этом обязан сохраниться — иначе смена поиска молча сбрасывала
    // бы вкладку и сортировку.
    expect(url.searchParams.get('tab')).toBe('lists')
    expect(url.searchParams.get('sort')).toBe('recent')
    expect(url.searchParams.get('q')).toBe('докер')
    currentParams = new URLSearchParams()
  })
})
