import { describe, it, expect } from 'vitest'
import { slugify } from '@/features/library/slug'

describe('slugify', () => {
  it('транслитерирует кириллицу, а не вырезает её', () => {
    expect(slugify('Домашнее маршмеллоу')).toBe('domashnee-marshmellou')
  })

  it('никогда не возвращает вырожденный слаг (регрессия /owner/-/releases)', () => {
    // Заголовки, где после нормализации не остаётся ни букв, ни цифр.
    for (const title of ['—', '- - -', '...', '!!!', '   ', '«»']) {
      const s = slugify(title)
      expect(s, `слаг для «${title}»`).toMatch(/[a-z0-9]/)
      expect(s).not.toBe('-')
    }
  })

  it('не оставляет дефисы по краям', () => {
    expect(slugify('  Привет, мир!  ')).toBe('privet-mir')
  })

  it('латиницу и цифры оставляет как есть', () => {
    expect(slugify('Deploy to VPS 2026')).toBe('deploy-to-vps-2026')
  })
})
