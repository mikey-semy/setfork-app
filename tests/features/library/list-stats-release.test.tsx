import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListStats } from '@/features/library/ListStats'

/**
 * ВЕРСИЯ СКИЛЛА В СВОДКЕ — последний релиз, а не номер правки (решение владельца 25.09).
 *
 * Как npm у пакета и «Latest» у GitHub: снаружи скилл знают по v0.7.0. Правки после
 * выпуска — хвостом «· +N правок», как `v0.7.0-1` у git describe. Номер правки (v6)
 * остаётся в строке последней правки — это аналог хеша коммита.
 */
const base = { base: '/miki/kit', stars: 0, forks: 0, watchers: 0, runs: 0, branches: 1, visibility: 'public' as const, status: 'published' as const }
const text = () => document.body.textContent ?? ''

describe('ListStats — версия', () => {
  it('у скилла с релизом — тег вместо номера правки', () => {
    render(<ListStats {...base} lang="ru" version={6} release={{ tag: 'v0.7.0', ahead: 0 }} />)
    expect(text()).toContain('v0.7.0')
    expect(text()).not.toContain('v6')
    expect(text()).not.toContain('+')
  })

  it('правки после релиза — хвостом с верной формой слова', () => {
    render(<ListStats {...base} lang="ru" version={6} release={{ tag: 'v0.7.0', ahead: 1 }} />)
    expect(text()).toContain('v0.7.0 · +1 правка')
  })

  it('пять правок — «правок»; по-английски — edits', () => {
    const { unmount } = render(<ListStats {...base} lang="ru" version={10} release={{ tag: 'v1.0.0', ahead: 5 }} />)
    expect(text()).toContain('+5 правок')
    unmount()
    render(<ListStats {...base} lang="en" version={10} release={{ tag: 'v1.0.0', ahead: 2 }} />)
    expect(text()).toContain('+2 edits')
  })

  it('без релиза — номер правки, как у обычного списка', () => {
    render(<ListStats {...base} lang="ru" version={6} />)
    expect(text()).toContain('v6')
  })

  it('«Новый релиз» — только когда позвали (скилл без релиза, смотрит владелец)', () => {
    const { unmount } = render(<ListStats {...base} lang="ru" version={6} />)
    expect(screen.queryByRole('link', { name: 'Новый релиз' })).toBeNull()
    unmount()
    render(<ListStats {...base} lang="ru" version={6} releaseHint />)
    expect(screen.getByRole('link', { name: 'Новый релиз' }).getAttribute('href')).toBe('/miki/kit/releases/new')
  })
})
