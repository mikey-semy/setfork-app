import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIELD_BOX } from '@/shared/ui/control'

/**
 * Гейты доступности дизайн-системы (линза 07, реестр 2026-08-01):
 *  - text-muted был 2.30:1 при норме WCAG AA 4.5:1 — держим контраст токена
 *    в ОБЕИХ темах против худшего фона (surface белее bg);
 *  - фокус полей ввода был невидим (только focus:border-border-strong,
 *    1.39:1 у кнопочного кольца) — держим явный focus-ring в примитивах.
 */

const css = readFileSync(join(__dirname, '../../../src/app/globals.css'), 'utf8')

/** Все значения токена по порядку объявления: [light, dark]. */
function tokenValues(name: string): string[] {
  return [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1])
}

function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('контраст токенов (WCAG AA)', () => {
  it('--muted ≥ 4.5:1 на canvas и surface в обеих темах', () => {
    const muted = tokenValues('muted')
    const canvas = tokenValues('canvas')
    const surface = tokenValues('surface')
    expect(muted.length, 'ожидаем light+dark значения --muted').toBeGreaterThanOrEqual(2)
    expect(canvas.length, 'ожидаем light+dark значения --canvas').toBeGreaterThanOrEqual(2)
    for (const theme of [0, 1]) {
      for (const back of [canvas[theme], surface[theme]]) {
        const ratio = contrast(muted[theme], back)
        expect(ratio, `--muted ${muted[theme]} на ${back} (${theme === 0 ? 'light' : 'dark'})`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('видимый фокус в примитивах', () => {
  it('FIELD_BOX несёт focus-visible ring', () => {
    expect(FIELD_BOX).toMatch(/focus-visible:ring/)
  })

  it('кнопка несёт контрастное фокус-кольцо (не border-strong 1.39:1)', () => {
    const button = readFileSync(join(__dirname, '../../../src/shared/ui/button.tsx'), 'utf8')
    expect(button).toMatch(/focus-visible:ring-accent/)
    expect(button).not.toMatch(/focus-visible:ring-border-strong/)
  })
})
