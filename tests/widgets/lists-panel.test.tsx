import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('данные сменились под панелью', () => {
  it('страница сбрасывается, когда набор изменился, а не показывает снимок «до»', async () => {
    const user = userEvent.setup()
    const loadPage = vi.fn(async (offset: number) => page(offset / DASHBOARD_LISTS + 1))
    const props = { lang: 'en' as const, title: 'Lists', initialLimit: DASHBOARD_LISTS, loadPage }

    const { rerender } = render(<ListsPanel {...props} items={page(1)} total={500} />)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('2 / 72')).toBeInTheDocument())

    // Создали список: с сервера приехал другой набор и другой счёт.
    rerender(<ListsPanel {...props} items={[item(0), ...page(1).slice(0, 6)]} total={501} />)

    // Панель обязана показать свежее, а не строки, снятые до изменения.
    expect(screen.getByText('1 / 72')).toBeInTheDocument()
    expect(screen.getByText('List 0')).toBeInTheDocument()
  })
})

describe('рвущаяся сеть', () => {
  it('ответ, ушедший до смены набора, не возвращает снимок «до»', async () => {
    const user = userEvent.setup()
    let release: (rows: ListsPanelItem[]) => void = () => {}
    const loadPage = vi.fn(() => new Promise<ListsPanelItem[]>((res) => { release = res }))
    const props = { lang: 'en' as const, title: 'Lists', initialLimit: DASHBOARD_LISTS, loadPage }

    const { rerender } = render(<ListsPanel {...props} items={page(1)} total={500} />)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    // Пока страница едет, набор сменился с сервера.
    rerender(<ListsPanel {...props} items={[item(0), ...page(1).slice(0, 6)]} total={501} />)
    // ...и только теперь приходит ответ старого поколения.
    release(page(2))

    await waitFor(() => expect(screen.getByText('List 0')).toBeInTheDocument())
    // Он не должен отменить сброс: страница первая, строки свежие.
    expect(screen.queryByText('List 8')).not.toBeInTheDocument()
  })

  it('страница, которая не приходит никогда, не запирает панель навсегда', async () => {
    // Фейковые таймеры без userEvent: тот сам ждёт таймеров, и связка вешала весь файл —
    // упавший по таймауту тест не успевал вернуть настоящие часы следующему.
    vi.useFakeTimers()
    try {
      const loadPage = vi.fn(() => new Promise<ListsPanelItem[]>(() => {}))
      render(<ListsPanel items={page(1)} lang="en" title="Lists" initialLimit={DASHBOARD_LISTS} total={500} loadPage={loadPage} />)

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
      })

      // Без потолка ожидания «Загрузка…» висела бы вечно, обе стрелки мертвы, выход —
      // только перезагрузка.
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load. Try again.')
      expect(screen.getByRole('button', { name: 'Next page' })).not.toHaveAttribute('aria-disabled', 'true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('упавший поиск не выдаётся за «ничего не найдено»', async () => {
    const user = userEvent.setup()
    const remoteSearch = vi.fn(async () => {
      throw new Error('offline')
    })
    render(<ListsPanel items={page(1)} lang="en" title="Lists" initialLimit={DASHBOARD_LISTS} total={500} remoteSearch={remoteSearch} loadPage={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Find a list…'), 'nginx')

    // «Ничего не найдено» — это ответ про корпус. Про запрос, который не выполнился,
    // такого ответа нет.
    await waitFor(() => expect(screen.getByText('Could not load. Try again.')).toBeInTheDocument())
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument()
  })
})

describe('панель на втором языке', () => {
  // Фильтр панели и поиск на сервере стоят за ОДНИМ полем ввода, поэтому обязаны
  // отвечать одинаково. Серверный смотрит `title->>'en' || title->>'ru'` (titleText),
  // а панель смотрела `tr(title, lang)` — одну строку, ту, что показана читателю.
  // Слаг НАМЕРЕННО не повторяет ни один из заголовков: с говорящим слагом
  // (`bread-baking`) фильтр находит список по подстроке слага и выглядит исправным на
  // любом языке — так эта дыра и держалась. Проверять надо там, где слаг не подсказывает.
  const bilingual: ListsPanelItem[] = [
    { handle: 'miki', slug: 'starter-notes', title: { en: 'Sourdough', ru: 'Закваска' }, avatarUrl: null },
    { handle: 'miki', slug: 'vps', title: { en: 'Deploy', ru: 'Деплой' }, avatarUrl: null },
  ]

  const found = () => screen.getAllByRole('link').map((l) => l.getAttribute('href'))

  it('находит список по ЛЮБОМУ из его заголовков, а не только по показанному', async () => {
    const user = userEvent.setup()
    render(<ListsPanel items={bilingual} lang="ru" title="Списки" initialLimit={1} searchable />)

    // Русскому читателю показана «Закваска», но искать «sourdough» он вправе: тот же
    // запрос на вкладке профиля этот список находит, потому что SQL смотрит оба заголовка.
    await user.type(screen.getByRole('textbox'), 'sourdough')
    await waitFor(() => expect(found()).toEqual(['/miki/starter-notes']))
  })

  it('и в обратную сторону: английский читатель находит по русскому заголовку', async () => {
    const user = userEvent.setup()
    render(<ListsPanel items={bilingual} lang="en" title="Lists" initialLimit={1} searchable />)

    await user.type(screen.getByRole('textbox'), 'закваск')
    await waitFor(() => expect(found()).toEqual(['/miki/starter-notes']))
  })

  it('регистр не важен и на кириллице — как в SQL-половине того же поиска', async () => {
    const user = userEvent.setup()
    render(<ListsPanel items={bilingual} lang="ru" title="Списки" initialLimit={1} searchable />)

    await user.type(screen.getByRole('textbox'), 'ЗАКВАСКА')
    await waitFor(() => expect(found()).toEqual(['/miki/starter-notes']))
  })
})

describe('поиск не ограничен показанными строками', () => {
  /**
   * ⚠️ ПОЛЕ ПОИСКА, ФИЛЬТРУЮЩЕЕ ЗАГРУЖЕННОЕ, ОТВЕЧАЕТ «НИЧЕГО НЕ НАЙДЕНО» ПРО ТО,
   * ЧЕГО НЕ ИСКАЛО.
   *
   * В боковом меню лежат последние SIDEBAR_LISTS списков. Владелец ввёл «Гно»
   * (02.09.2026), получил «Ничего не найдено» — а список с гномами существовал и
   * находился обычным поиском: он просто не попал в десятку недавних. Форма из GitHub,
   * снимок которого он приложил: то же поле в том же месте ищет по ВСЕМ репозиториям.
   */
  it('находит то, чего нет в загруженных строках', async () => {
    const user = userEvent.setup()
    const missing = { handle: 'miki', slug: 'gnomes', title: { ru: 'Гномы' }, avatarUrl: null }
    const remoteSearch = vi.fn(async () => [missing])
    render(<ListsPanel items={page(1)} lang="ru" title="Списки" searchable initialLimit={DASHBOARD_LISTS} remoteSearch={remoteSearch} />)

    await user.type(screen.getByPlaceholderText('Найти список…'), 'Гно')

    await waitFor(() => expect(screen.getByText('Гномы')).toBeInTheDocument())
    expect(remoteSearch, 'запрос обязан уйти на сервер').toHaveBeenCalledWith('гно')
    expect(screen.queryByText(/Ничего не найдено/)).not.toBeInTheDocument()
  })

  it('пока сервер отвечает, панель говорит «ищу», а не «не найдено»', async () => {
    const user = userEvent.setup()
    let release = (_: { handle: string; slug: string; title: { ru: string }; avatarUrl: null }[]) => {}
    const remoteSearch = vi.fn(
      () => new Promise<{ handle: string; slug: string; title: { ru: string }; avatarUrl: null }[]>((res) => (release = res)),
    )
    render(<ListsPanel items={page(1)} lang="ru" title="Списки" searchable initialLimit={DASHBOARD_LISTS} remoteSearch={remoteSearch} />)

    await user.type(screen.getByPlaceholderText('Найти список…'), 'Гно')
    await waitFor(() => expect(screen.getByText('Ищу…')).toBeInTheDocument())
    expect(screen.queryByText(/Ничего не найдено/), 'ответа ещё нет — говорить нечего').not.toBeInTheDocument()

    release([])
    // ⚠️ Ищем ПОДСТРОКОЙ: в словаре у этой фразы есть точка, и точное совпадение молча
    // не находило бы её — отрицательная проверка выше проходила бы вхолостую.
    await waitFor(() => expect(screen.getByText(/Ничего не найдено/)).toBeInTheDocument())
  })
})
