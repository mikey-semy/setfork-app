import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/shared/ui/badge'
import { ListKindBadges } from '@/features/library/ListKindBadges'

/**
 * ТЕКСТ В ПЛАШКЕ — ПО ЦЕНТРУ БУКВ (замечание владельца 25.09: «Skill» сидела выше
 * середины пилюли). Раскладку jsdom не считает — её меряли на стенде по пикселям
 * (Hanken −0.83 → −0.17 CSS px, Inter и Manrope ≤ 0.17). Здесь — устройство, без
 * которого выравнивания нет: текст в строчном боксе с обрезкой text-box.
 */
describe('Badge', () => {
  it('текст — в своём боксе с обрезкой по заглавным и базовой линии', () => {
    const { container } = render(<Badge>Skill</Badge>)
    const inner = container.querySelector('span > span')!
    expect(inner.textContent).toBe('Skill')
    expect(inner.className).toContain('[text-box:trim-both_cap_alphabetic]')
  })

  it('значки и прочие элементы не заворачиваются', () => {
    const { container } = render(
      <Badge>
        <svg data-testid="icon" /> 3
      </Badge>,
    )
    expect(container.querySelector('span > svg')).not.toBeNull()
  })
})

describe('ListKindBadges', () => {
  it('без значков — одно слово, как «Public template» у GitHub', () => {
    const { container } = render(<ListKindBadges item={{ isSkill: true, isTemplate: true }} lang="ru" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('СкиллШаблон')
  })
})
