import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pagination } from '@/shared/ui/Pagination'
import { TOUCH_MIN_BOX } from '@/shared/ui/control'

const href = (p: number) => `/x?page=${p}`

describe('Pagination', () => {
  it('<= 1 страницы → ничего не рендерит', () => {
    const { container } = render(<Pagination page={1} totalPages={1} makeHref={href} lang="en" />)
    expect(container.firstChild).toBeNull()
  })

  it('первая страница: Previous отключён (не ссылка), Next ведёт на page 2', () => {
    render(<Pagination page={1} totalPages={3} makeHref={href} lang="en" />)
    expect(screen.queryByRole('link', { name: /previous/i })).toBeNull()
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute('href', '/x?page=2')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('последняя страница: Next отключён, Previous ведёт на page-1', () => {
    render(<Pagination page={3} totalPages={3} makeHref={href} lang="en" />)
    expect(screen.queryByRole('link', { name: /next/i })).toBeNull()
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute('href', '/x?page=2')
  })

  it('средняя страница: обе ссылки с верными href', () => {
    render(<Pagination page={2} totalPages={5} makeHref={href} lang="en" />)
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute('href', '/x?page=1')
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute('href', '/x?page=3')
  })

  it('локализация: видимая подпись короткая, а объявляемая — полная', () => {
    render(<Pagination page={2} totalPages={3} makeHref={href} lang="ru" />)
    // Глазами — «Назад/Вперёд»: рядом с номерами длинная подпись только мешает.
    expect(screen.getByText('Назад')).toBeInTheDocument()
    expect(screen.getByText('Вперёд')).toBeInTheDocument()
    // Голосом — целиком: «Назад» среди номеров страниц не отвечает на вопрос «куда назад».
    // WCAG 2.5.3 (Label in Name): объявляемое имя ОБЯЗАНО содержать видимую подпись —
    // иначе голосовое управление по команде «Назад» не находит эту же кнопку.
    const prev = screen.getByRole('link', { name: 'Назад, на предыдущую страницу' })
    const next = screen.getByRole('link', { name: 'Вперёд, на следующую страницу' })
    expect(prev).toHaveAttribute('href', '/x?page=1')
    expect(next).toHaveAttribute('href', '/x?page=3')
    expect(prev.getAttribute('aria-label')).toContain('Назад')
    expect(next.getAttribute('aria-label')).toContain('Вперёд')
  })

  it('номера страниц: текущая помечена, соседние ведут ссылками', () => {
    render(<Pagination page={2} totalPages={3} makeHref={href} lang="en" />)
    expect(screen.getByRole('link', { name: 'Page 3' })).toHaveAttribute('href', '/x?page=3')
    // Текущая — не ссылка: нажимать на страницу, где уже стоишь, некуда.
    expect(screen.queryByRole('link', { name: 'Page 2' })).toBeNull()
    expect(screen.getByText('2')).toHaveAttribute('aria-current', 'page')
  })

  it('длинная выдача сворачивается многоточиями, а не рядом из сотни номеров', () => {
    render(<Pagination page={40} totalPages={74} makeHref={href} lang="en" />)
    for (const p of ['1', '39', '40', '41', '74']) expect(screen.getByText(p)).toBeInTheDocument()
    expect(screen.getAllByText('…')).toHaveLength(2)
    expect(screen.queryByText('20')).toBeNull()
  })

  it('без общего числа листает по признаку «дальше есть»', () => {
    render(<Pagination page={3} hasNext makeHref={href} lang="en" />)
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/x?page=4')
    expect(screen.getByText('3')).toBeInTheDocument()
    // Номера последней страницы нет и выдумывать его нельзя: его намеренно не считали.
    expect(screen.queryByText(/\//)).toBeNull()
  })

  it('дальше некуда — листалки нет вовсе', () => {
    const { container } = render(<Pagination page={1} hasNext={false} makeHref={href} lang="en" />)
    expect(container.firstChild).toBeNull()
  })

  it('без общего числа «вперёд» гаснет на КАЖДОЙ странице, а не только на первой', () => {
    // На первой странице листалку целиком снимал общий выход «листать некуда», поэтому
    // проверка на ней ничего не доказывала: со второй ссылка вела на несуществующую третью.
    render(<Pagination page={2} hasNext={false} makeHref={href} lang="en" />)
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull()
    // Назад при этом можно всегда: пройденные страницы существуют по построению.
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute('href', '/x?page=1')
  })

  it('и остаётся живой, пока разведчик говорит «дальше есть»', () => {
    render(<Pagination page={4} hasNext makeHref={href} lang="en" />)
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/x?page=5')
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute('href', '/x?page=3')
  })

  describe('доступность', () => {
    it('край не выбрасывается из обхода: фокус остаётся на кнопке, а не падает в body', () => {
      // Настоящий `disabled` снимает фокус с только что нажатой стрелки, когда долистал до
      // края, — место теряется в награду за то, что дошёл до конца.
      render(<Pagination page={5} totalPages={5} onPage={vi.fn()} lang="en" />)
      const next = screen.getByRole('button', { name: 'Next page' })
      expect(next).toBeEnabled()
      expect(next).toHaveAttribute('aria-disabled', 'true')
      next.focus()
      expect(document.activeElement).toBe(next)
    })

    it('нажатие на погашенный край ничего не делает', () => {
      const onPage = vi.fn()
      render(<Pagination page={5} totalPages={5} onPage={onPage} lang="en" />)
      screen.getByRole('button', { name: 'Next page' }).click()
      expect(onPage).not.toHaveBeenCalled()
    })

    it('погашенная стрелка-ссылка не попадает в дерево доступности безымянной', () => {
      // Она не действие и ничего не сообщает; безымянный значок — это шум в ленте.
      const { container } = render(<Pagination page={1} totalPages={5} makeHref={href} lang="en" />)
      expect(screen.queryByRole('link', { name: /previous/i })).toBeNull()
      expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
    })

    it('текущая страница помечена и в кнопочном режиме, а не только цветом', () => {
      render(<Pagination page={3} totalPages={5} onPage={vi.fn()} lang="en" />)
      expect(screen.getByText('3')).toHaveAttribute('aria-current', 'page')
    })

    it('смена страницы объявляется независимо от ширины экрана', () => {
      // Живая область раньше висела на видимой подписи, а её с sm прячет display:none —
      // то есть на десктопе не объявлялось ничего.
      const { container } = render(<Pagination page={3} totalPages={5} makeHref={href} lang="en" />)
      const live = container.querySelector('[aria-live="polite"]')
      expect(live).toHaveClass('sr-only')
      expect(live).toHaveTextContent('Page 3 / 5')
    })
  })

  describe('мобильный экран', () => {
    it('шаг несёт тач-цель проекта, а не остаётся 32px по шкале вида', () => {
      // У проекта это записанное правило (control.ts): вид по шкале, цель добирается
      // классом. Рукописная листалка его не брала — а такую ошибку тут уже ловили дважды.
      render(<Pagination page={2} totalPages={5} makeHref={href} lang="en" />)
      for (const cls of TOUCH_MIN_BOX.split(' ')) {
        expect(screen.getByRole('link', { name: 'Next page' })).toHaveClass(cls)
      }
    })

    it('во время загрузки шаг не становится disabled — иначе фокус улетает в body', () => {
      const onPage = vi.fn()
      render(<Pagination page={2} totalPages={5} onPage={onPage} busy lang="en" />)
      const next = screen.getByRole('button', { name: 'Next page' })
      // Кнопка остаётся в дереве и держит фокус, но говорит «занято».
      expect(next).toBeEnabled()
      expect(next).toHaveAttribute('aria-disabled', 'true')
      next.focus()
      expect(document.activeElement).toBe(next)
    })

    it('подпись положения держит ширину, пока едет страница', () => {
      // Иначе «6 / 74» → «Загрузка…» разъезжает обе стрелки ровно под занесённым пальцем.
      const { rerender } = render(<Pagination page={2} totalPages={5} onPage={vi.fn()} compact lang="en" />)
      expect(screen.getByText('2 / 5')).toHaveClass('min-w-[4.5rem]')
      rerender(<Pagination page={2} totalPages={5} onPage={vi.fn()} compact busy lang="en" />)
      // «Загрузка…» теперь и в видимой подписи, и в скрытой живой области — берём видимую.
      expect(screen.getAllByText('Loading…').some((el) => el.className.includes('min-w-[4.5rem]'))).toBe(true)
    })
  })
})

describe('Pagination: режим keyset (курсор)', () => {
  it('оба шага есть → две ссылки и НИ ОДНОГО номера', () => {
    render(<Pagination steps={{ prev: '/n?before=a', next: '/n?after=b' }} lang="en" />)
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute('href', '/n?before=a')
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute('href', '/n?after=b')
    // Номер страницы на пополняемой ленте невыразим, и выдумывать его нельзя.
    expect(screen.queryByText(/\d+\s*\/\s*\d+/)).toBeNull()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('шага нет → его нет и в разметке: вечно мёртвая стрелка обещает несуществующее действие', () => {
    const { container } = render(<Pagination steps={{ prev: null, next: '/n?after=b' }} lang="en" />)
    expect(screen.getByRole('link', { name: /next/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /previous/i })).toBeNull()
    // Именно НЕТ, а не погашенный край: в номерном режиме край временный и оживёт,
    // здесь — нет, пока не появится зеркальный `?before=`. Ищем прямого потомка nav:
    // `aria-hidden` есть и у подписи ВНУТРИ живой ссылки, и она тут ни при чём.
    expect(container.querySelectorAll('nav > span[aria-hidden]')).toHaveLength(0)
  })

  it('шагать некуда → листалки нет вовсе', () => {
    const { container } = render(<Pagination steps={{ prev: null, next: null }} lang="en" />)
    expect(container.firstChild).toBeNull()
  })

  it('загрузка объявляется, а номер страницы — нет', () => {
    render(<Pagination steps={{ prev: null, next: '/n?after=b' }} busy lang="en" />)
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).toBeInTheDocument()
    expect(live).not.toHaveTextContent(/page\s*\d/i)
  })
})

describe('Pagination: число найденного и предзагрузка', () => {
  it('счёт показывается ОТДЕЛЬНОЙ строкой, а ряд остаётся прежним', () => {
    // Ряд отцентрован, и любое изменение его содержимого разъезжает обе стрелки — палец,
    // занесённый над «вперёд», попадает мимо. Поэтому счёт живёт над рядом, а «2 / 3»
    // остаётся на месте.
    render(<Pagination page={2} totalPages={3} total={518} makeHref={href} lang="en" />)
    expect(screen.getByText('518')).toBeInTheDocument()
    expect(screen.getByText(/Found/)).toBeInTheDocument()
    const nav = screen.getByRole('navigation')
    expect(nav).not.toHaveTextContent('518')
  })

  it('счёт остаётся, когда страница ОДНА', () => {
    // Ровно тот случай, ради которого счёт и заводили: отбор сузил выдачу до горстки
    // строк, листать нечего — и человек не видит ни «1 / 1», ни числа найденного.
    render(<Pagination page={1} totalPages={1} total={5} makeHref={href} lang="en" />)
    expect(screen.getByText(/Found/)).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    // Ряда при этом нет: пустое место под ним читается как «дальше что-то есть».
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('ни счёта, ни ряда — ничего', () => {
    const { container } = render(<Pagination page={1} totalPages={1} makeHref={href} lang="en" />)
    expect(container.firstChild).toBeNull()
  })

  it('без счёта лишнего узла нет', () => {
    const { container } = render(<Pagination page={2} totalPages={3} makeHref={href} lang="en" />)
    expect(screen.queryByText(/Found/)).toBeNull()
    // Ряд остаётся корнем: обёртка заводится только когда есть что показать над ним.
    expect(container.firstChild).toBe(screen.getByRole('navigation'))
  })
})

describe('Pagination: подпись и имя — на ОБОИХ языках', () => {
  /**
   * WCAG 2.5.3 (Label in Name) — правило, ради которого заведена линза локализации: на
   * английском оно проходит по совпадению («Previous» — префикс «Previous page»), а на
   * русском «Назад» и «Предыдущая страница» не пересекаются ни словом, и голосовая команда
   * по видимой подписи кнопку не находит.
   *
   * Прежняя проверка стояла на одном языке и одном режиме. Проверяем обе локали и оба
   * режима: у keyset шаги свои, и правило могло не доехать до них вовсе.
   */
  it.each([
    ['ru' as const, 'Назад', 'Вперёд'],
    ['en' as const, 'Previous', 'Next'],
  ])('номерной режим, %s', (lang, prevShort, nextShort) => {
    render(<Pagination page={2} totalPages={3} makeHref={href} lang={lang} />)
    const prev = screen.getByRole('link', { name: new RegExp(prevShort, 'i') })
    const next = screen.getByRole('link', { name: new RegExp(nextShort, 'i') })
    expect(prev.getAttribute('aria-label')).toContain(prevShort)
    expect(next.getAttribute('aria-label')).toContain(nextShort)
    // Видимая подпись есть в разметке — иначе сверять было бы не с чем.
    expect(prev).toHaveTextContent(prevShort)
    expect(next).toHaveTextContent(nextShort)
  })

  it.each([
    ['ru' as const, 'Назад', 'Вперёд'],
    ['en' as const, 'Previous', 'Next'],
  ])('режим keyset, %s', (lang, prevShort, nextShort) => {
    render(<Pagination steps={{ prev: '/n?before=a', next: '/n?after=b' }} lang={lang} />)
    const prev = screen.getByRole('link', { name: new RegExp(prevShort, 'i') })
    const next = screen.getByRole('link', { name: new RegExp(nextShort, 'i') })
    expect(prev.getAttribute('aria-label')).toContain(prevShort)
    expect(next.getAttribute('aria-label')).toContain(nextShort)
  })
})
