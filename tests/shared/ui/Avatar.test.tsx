import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Avatar } from '@/shared/ui/Avatar'

describe('Avatar', () => {
  it('есть avatarUrl → <img> с src и alt=handle', () => {
    render(<Avatar handle="alice" avatarUrl="https://cdn/x.png" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://cdn/x.png')
    expect(img).toHaveAttribute('alt', 'alice')
  })

  it('битый src (onError) → откат на identicon (25 ячеек, без img)', () => {
    render(<Avatar handle="bob" avatarUrl="https://cdn/broken.png" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    // identicon — сетка 5×5 из 25 span-ячеек
  })

  it('нет avatarUrl → сразу identicon (25 ячеек)', () => {
    const { container } = render(<Avatar handle="carol" avatarUrl={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelectorAll('span')).toHaveLength(25)
  })

  it('identicon детерминирован по handle (одинаковый разметка для одного ника)', () => {
    const a = render(<Avatar handle="same" avatarUrl={null} />)
    const b = render(<Avatar handle="same" avatarUrl={null} />)
    expect(a.container.innerHTML).toBe(b.container.innerHTML)
  })
})
