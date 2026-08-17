import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pagination } from '@/shared/ui/Pagination'

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
    expect(screen.getByRole('link', { name: 'Предыдущая страница' })).toHaveAttribute('href', '/x?page=1')
    expect(screen.getByRole('link', { name: 'Следующая страница' })).toHaveAttribute('href', '/x?page=3')
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
})
