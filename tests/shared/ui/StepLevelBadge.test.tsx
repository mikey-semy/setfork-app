import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { t } from '@/shared/i18n'

describe('StepLevelBadge', () => {
  it("required (норма) → ничего не рисует", () => {
    const { container } = render(<StepLevelBadge level="required" lang="en" />)
    expect(container.firstChild).toBeNull()
  })

  it('recommended → подпись из словаря + warn-стиль', () => {
    render(<StepLevelBadge level="recommended" lang="en" />)
    const el = screen.getByText(t('levelRecommended', 'en'))
    expect(el).toBeInTheDocument()
    expect(el.className).toContain('border-warn')
  })

  it('optional → своя подпись, без warn-стиля', () => {
    render(<StepLevelBadge level="optional" lang="en" />)
    const el = screen.getByText(t('levelOptional', 'en'))
    expect(el).toBeInTheDocument()
    expect(el.className).not.toContain('border-warn')
  })
})
