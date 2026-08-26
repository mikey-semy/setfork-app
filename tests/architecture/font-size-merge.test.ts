import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cn, FONT_SIZE_STEPS, SHADOW_STEPS } from '@/shared/lib/cn'

/**
 * ЛЕСТНИЦА КЕГЛЕЙ И СКЛЕЙКА КЛАССОВ ОБЯЗАНЫ ЗНАТЬ ДРУГ О ДРУГЕ.
 *
 * `text-*` в Tailwind двусмысленно: `text-sm` — размер, `text-muted` — цвет, и что
 * именно перед ним, tailwind-merge решает валидатором. Наши ступени (`text-body`,
 * `text-caption`) он по умолчанию принимает за ЦВЕТ — и при склейке выбрасывает
 * настоящий цвет рядом как конфликтующий.
 *
 * Это не гипотеза: 26.08.2026, в тот же час, когда лестница переехала в тему,
 * основная кнопка потеряла `text-primary-fg` — `buttonClass` склеивает вид и размер
 * одним `cn`. Поймал тест панели списков профиля, а не глаз и не типы.
 *
 * Поэтому здесь два сторожа: список ступеней не расходится с темой, и склейка
 * ведёт себя правильно на обоих направлениях (размер+цвет — оба; размер+размер —
 * последний).
 */

const THEME = readFileSync('src/app/globals.css', 'utf8')

describe('лестница кеглей', () => {
  it('список для склейки не разошёлся с темой', () => {
    const inTheme = [...THEME.matchAll(/^\s*--text-([a-z0-9-]+):/gm)].map((m) => m[1])
    expect(inTheme.length).toBeGreaterThan(0)
    expect([...inTheme].sort()).toEqual([...FONT_SIZE_STEPS].sort())
  })

  it('список теней не разошёлся с темой', () => {
    const inTheme = [...THEME.matchAll(/^\s*--shadow-([a-z0-9-]+):/gm)].map((m) => m[1])
    expect([...inTheme].sort()).toEqual([...SHADOW_STEPS].sort())
    expect(cn('shadow-card', 'shadow-none')).toBe('shadow-none')
  })

  it('склейка не путает ступень с цветом', () => {
    for (const step of FONT_SIZE_STEPS) {
      expect(cn(`text-${step}`, 'text-primary-fg'), `ступень ${step} съела цвет`).toBe(`text-${step} text-primary-fg`)
      expect(cn('text-primary-fg', `text-${step}`), `цвет съел ступень ${step}`).toBe(`text-primary-fg text-${step}`)
    }
  })

  it('две ступени схлопываются в последнюю', () => {
    expect(cn('text-body', 'text-title')).toBe('text-title')
    expect(cn('text-stat', 'text-caption')).toBe('text-caption')
  })
})
