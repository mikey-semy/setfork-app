import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelSelect } from '@/features/admin/ModelSelect'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { priceTiers, withSavedOption } from '@/features/admin/model-options'

/**
 * РЕГРЕССИЯ: «выбор моделей с ценами откатили».
 *
 * Никакого отката не было — при пустом каталоге поле подменялось голым текстовым вводом, и
 * связка выглядела как удалённая. Пустой каталог случается легко (сеть до провайдера, HTTP-код,
 * нет ключа), поэтому тесты фиксируют ровно то, что должно пережить любой такой сбой:
 * виджет остаётся селектом, сохранённая модель не исчезает, id можно ввести руками.
 */
describe('ModelSelect: каталог пуст', () => {
  const hidden = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`input[name="${name}"][type="hidden"]`)

  it('пустой список опций → это по-прежнему селект (кнопка-триггер), а не текстовое поле', () => {
    const { container } = render(<ModelSelect name="chatModel" defaultValue="anthropic/claude-3.5-haiku" options={[]} allowCustom />)

    expect(screen.getByRole('button')).toBeTruthy()
    // Единственный input — скрытый носитель значения формы; видимого текстового поля нет.
    expect(container.querySelector('input[type="text"]')).toBeNull()
    expect(hidden(container, 'chatModel')?.value).toBe('anthropic/claude-3.5-haiku')
  })

  it('сохранённая модель показана в триггере, даже когда каталога нет', () => {
    render(<ModelSelect name="chatModel" defaultValue="anthropic/claude-3.5-haiku" options={[]} allowCustom />)
    expect(screen.getByRole('button').textContent).toContain('anthropic/claude-3.5-haiku')
  })

  it('id можно ввести руками прямо в поиске → значение уходит в форму', () => {
    const { container } = render(<ModelSelect name="chatModel" defaultValue="" options={[]} allowCustom customHint="Использовать" />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByLabelText('Поиск модели'), { target: { value: 'openai/gpt-4o-mini' } })

    const custom = screen.getByText('openai/gpt-4o-mini')
    fireEvent.click(custom)
    expect(hidden(container, 'chatModel')?.value).toBe('openai/gpt-4o-mini')
  })

  it('без allowCustom свободный ввод не предлагается (обычный каталог не замусоривается)', () => {
    render(<ModelSelect name="chatModel" defaultValue="" options={[{ value: 'a/b', id: 'a/b' }]} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByLabelText('Поиск модели'), { target: { value: 'zzz/nope' } })

    expect(screen.queryByText('zzz/nope')).toBeNull()
    expect(screen.getByText('Ничего не найдено')).toBeTruthy()
  })

  it('модель из каталога не дублируется строкой свободного ввода', () => {
    render(<ModelSelect name="chatModel" defaultValue="" options={[{ value: 'a/b', id: 'a/b' }]} allowCustom customHint="Использовать" />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByLabelText('Поиск модели'), { target: { value: 'a/b' } })

    expect(screen.queryByText('Использовать')).toBeNull()
    expect(screen.getAllByText('a/b')).toHaveLength(1)
  })
})

/**
 * ВЫБОР ПО СМЫСЛУ, а не по алфавиту: список отвечает на «что взять» до того, как его прочитали.
 * Порядок групп (в работе → пробовали → не пробовали) и наш рейтинг в строке — это и есть ответ,
 * поэтому они зафиксированы тестом: развалятся молча, и селект снова станет стеной из 336 строк.
 */
describe('ModelSelect: группы по нашему опыту и рейтинг', () => {
  const OPTS = [
    { value: 'z/fresh', id: 'z/fresh', label: 'Fresh One', meta: { group: 'fresh' as const } },
    {
      value: 'a/active',
      id: 'a/active',
      label: 'Active One',
      meta: {
        group: 'active' as const,
        calls: 412,
        okPct: 98,
        p95: '4.2с',
        ourCost: '$0.002',
        holders: [{ kind: 'chat' as const, label: 'Основная', what: 'Пишет финальный список' }],
      },
    },
    { value: 'b/tried', id: 'b/tried', label: 'Tried One', meta: { group: 'tried' as const, calls: 19, okPct: 72 } },
  ]

  it('порядок групп: в работе → пробовали → не пробовали (каким бы ни был порядок опций)', () => {
    // TooltipProvider — как в layout приложения: строка селекта объясняет цифры тултипами.
    render(
      <TooltipProvider>
        <ModelSelect name="chatModel" defaultValue="" options={OPTS} />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button'))

    const html = document.body.innerHTML
    expect(html.indexOf('В работе у нас')).toBeLessThan(html.indexOf('Пробовали раньше'))
    expect(html.indexOf('Пробовали раньше')).toBeLessThan(html.indexOf('Не пробовали'))
    expect(html.indexOf('Active One')).toBeLessThan(html.indexOf('Fresh One'))
  })

  it('строка показывает наш рейтинг и роль, на которой модель уже стоит', () => {
    // TooltipProvider — как в layout приложения: строка селекта объясняет цифры тултипами.
    render(
      <TooltipProvider>
        <ModelSelect name="chatModel" defaultValue="" options={OPTS} />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('98% · 412')).toBeTruthy()
    expect(screen.getByText('Основная')).toBeTruthy()
  })

  it('поиск находит модель по тому, КТО на ней сидит', () => {
    // TooltipProvider — как в layout приложения: строка селекта объясняет цифры тултипами.
    render(
      <TooltipProvider>
        <ModelSelect name="chatModel" defaultValue="" options={OPTS} />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByLabelText('Поиск модели'), { target: { value: 'основная' } })

    expect(screen.getByText('Active One')).toBeTruthy()
    expect(screen.queryByText('Fresh One')).toBeNull()
  })
})

/**
 * Пороги «дёшево/дорого» больше не числа в коде ($1/$10, ₽100/₽1000): они не переживали ни
 * смену провайдера, ни движение рынка. Считаем терцили самого каталога — «дорого» значит
 * «дорого относительно того, что предлагает этот провайдер».
 */
describe('priceTiers: границы цвета из самого каталога', () => {
  it('терцили растут вместе с ценами каталога', () => {
    const cheap = priceTiers([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
    const pricey = priceTiers([10, 20, 30, 40, 50, 60])
    expect(cheap[0]).toBeLessThan(cheap[1])
    expect(pricey[0]).toBeGreaterThan(cheap[1])
  })

  it('порядок валюты значения не имеет — шкала берётся из данных', () => {
    const usd = priceTiers([0.15, 0.6, 3, 15])
    const rub = priceTiers([0.15, 0.6, 3, 15].map((x) => x * 90))
    expect(rub[0] / usd[0]).toBeCloseTo(90, 6)
    expect(rub[1] / usd[1]).toBeCloseTo(90, 6)
  })

  it('меньше трёх известных цен → красить нечем (бесконечности = нейтральный цвет)', () => {
    expect(priceTiers([1, 2])).toEqual([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY])
    // Неизвестные и плавающие цены (Infinity в метрике) в расчёт не идут.
    expect(priceTiers([1, 2, Number.POSITIVE_INFINITY])).toEqual([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY])
  })
})

describe('withSavedOption: сохранённая модель не теряется', () => {
  it('каталог пуст → сохранённая модель всё равно опция, но ПОМЕЧЕНА как отсутствующая', () => {
    // missing — не украшение: такой id отвечает 404 при исправном ключе, и это должно быть
    // видно в списке, а не выясняться по пустым черновикам в проде.
    expect(withSavedOption([], 'gpt://folder/yandexgpt')).toEqual([
      { value: 'gpt://folder/yandexgpt', id: 'gpt://folder/yandexgpt', missing: true },
    ])
  })

  it('модель уже в каталоге → без дубля', () => {
    const opts = [{ value: 'a/b', id: 'a/b', price: '$1.00' }]
    expect(withSavedOption(opts, 'a/b')).toEqual(opts)
  })

  it('модель не сохранена → список не трогаем', () => {
    const opts = [{ value: 'a/b', id: 'a/b' }]
    expect(withSavedOption(opts, '')).toEqual(opts)
  })
})
