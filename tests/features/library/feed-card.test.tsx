import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CatalogRow } from '@/features/catalogs/CatalogRow'
import { ProfileCatalogCard } from '@/features/catalogs/ProfileCatalogCard'
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
  /**
   * ⚠️ ФОРМА ШАПКИ ИЗМЕНИЛАСЬ 01.09.2026 ПО РЕШЕНИЮ ВЛАДЕЛЬЦА, и прежние проверки здесь
   * заменены, а не подкручены. Было: «owner / заголовок» одной обрезаемой строкой, а
   * состояние — в строке показателей после версии. Стало: владелец и плашка состояния
   * первой строкой, заголовок — своей и целиком. Причина: у нас заголовки длиннее имён
   * репозиториев, и обрезалось на телефоне ровно самое важное, а состояние приходилось
   * вычитывать среди чисел. Эталон — бейдж `Private` у GitHub, он стоит за именем.
   */
  it('значка «проверен» на карточке нет даже при verified: true', () => {
    renderFeedCard()
    // Решение 0006 («видимость = верификация») запрещает публичный бейдж. Проверяем
    // именно при `verified: true` — иначе проверка проходила бы сама собой.
    expect(screen.queryByText('Проверен')).toBeNull()
  })

  it('опубликованный публичный список плашкой не помечается: норма не нуждается в метке', () => {
    renderFeedCard({ status: 'published', verified: false })
    expect(screen.queryByText('Публичный')).toBeNull()
    expect(screen.queryByText('Черновик')).toBeNull()
  })

  it('черновик помечен один раз — плашкой в шапке, а не в строке показателей', () => {
    const { container } = renderFeedCard()
    const badge = screen.getByText('Черновик')
    const header = container.querySelector('.border-b') as HTMLElement
    expect(header.contains(badge), 'плашка уехала из шапки — состояние снова придётся искать').toBe(true)
    expect(screen.getAllByText('Черновик')).toHaveLength(1)
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

describe('карточка каталога в профиле', () => {
  it('начинает заголовок слева и показывает реальное число списков', () => {
    render(
      <ProfileCatalogCard
        handle="miki"
        lang="ru"
        catalog={{
          id: 'catalog-1',
          name: 'workplace',
          title: { ru: 'Этап 0 — Рабочее место' },
          desc: {},
          listCount: 2,
        }}
      />,
    )

    const link = screen.getByRole('link', { name: /Этап 0 — Рабочее место/ })
    expect(link).toHaveClass('block', 'text-left')
    expect(link).not.toHaveClass('justify-center')
    // Было «2 списки» — тест закреплял ошибку согласования, а не проверял её. Словарное
    // `lists` это заголовок «Списки», у него нет падежей; формы берутся из plural().
    expect(screen.getByText('2 списка')).toBeInTheDocument()
  })
})

describe('состояние списка и плотность', () => {
  // ⚠️ С ОБЛОЖКОЙ: без неё проверка «плотный вид убирает обложку» была бы пустой —
  // картинки нет в фикстуре, и `queryByRole('img')` вернул бы null при любом коде
  // (поймано мутацией: снятие условия не роняло тест).
  const withCover = { ...item, coverImage: 'https://example.com/cover.jpg' }
  const card = (density?: 'comfy' | 'compact') =>
    render(
      <TooltipProvider delay={0}>
        <FeedCard item={withCover} lang="en" density={density} />
      </TooltipProvider>,
    )

  /**
   * ⚠️ Состояние показывают ОДИН раз и у имени. Раньше метка жила в строке показателей,
   * между версией и числом форков: чтобы понять, опубликован ли список, приходилось
   * вычитывать её среди чисел. Эталон — бейдж `Private` у GitHub, он стоит за именем
   * (решение владельца 01.09.2026).
   */
  it('состояние стоит плашкой у имени, а не среди чисел', () => {
    card()
    const badge = screen.getByText('Draft')
    // Шапка — та, где стоит имя владельца: у обложки выше тоже есть нижняя граница,
    // и селектор по классу брал бы её.
    const header = screen.getByRole('link', { name: 'miki' }).closest('div')?.parentElement as HTMLElement
    expect(header.contains(badge), 'плашка уехала из шапки — её снова придётся искать').toBe(true)
    expect(screen.getAllByText('Draft')).toHaveLength(1)
  })

  it('публичный список плашкой не помечается: норма не нуждается в метке', () => {
    render(
      <TooltipProvider delay={0}>
        <FeedCard item={{ ...item, status: 'published', visibility: 'public' }} lang="en" />
      </TooltipProvider>,
    )
    expect(screen.queryByText('Public')).toBeNull()
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('заголовок переносится, а не обрезается: у нас они длиннее имён репозиториев', () => {
    card()
    const title = screen.getByTitle('A very long translated list title')
    expect(title.className).not.toMatch(/truncate/)
    expect(title.className).toMatch(/overflow-wrap:anywhere/)
  })

  it('плотный вид убирает обложку, описание, теги и дату — то, что и занимает высоту', () => {
    const { container } = card('compact')
    expect(container.querySelector('img'), 'обложка осталась — она и есть самый крупный блок').toBeNull()
    expect(container.querySelector('p.line-clamp-2'), 'описание осталось — экономии нет').toBeNull()
    expect(screen.queryByText('test'), 'теги остались — проверка тегов была пустой').toBeNull()
    expect(container.textContent).not.toMatch(/updated/i)
  })

  it('заголовок не бесконечен: две строки, дальше многоточие', () => {
    const title = screen.getByTitle.bind(screen)
    card()
    expect((title('A very long translated list title') as HTMLElement).className).toMatch(/line-clamp-2/)
  })

  it('просторный вид — по умолчанию, и в нём всё это на месте', () => {
    const { container } = card()
    expect(container.querySelector('p.line-clamp-2')).toBeInTheDocument()
    expect(container.textContent).toMatch(/updated/i)
  })
})
