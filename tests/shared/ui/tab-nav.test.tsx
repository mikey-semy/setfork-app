import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TabItem } from '@/shared/ui/TabNav'

describe('счётчик вкладки', () => {
  it('центрирует число внутри фиксированного круглого бейджа', () => {
    render(<TabItem href="/alice?tab=lists" on={false} label="Lists" count={3} />)

    expect(screen.getByText('3')).toHaveClass('inline-flex', 'h-5', 'min-w-5', 'items-center', 'justify-center', 'leading-none')
  })
})
