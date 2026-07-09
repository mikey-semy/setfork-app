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

  it('локализация: ru-подписи', () => {
    render(<Pagination page={2} totalPages={3} makeHref={href} lang="ru" />)
    expect(screen.getByRole('link', { name: /Назад/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Вперёд/ })).toBeInTheDocument()
  })
})
