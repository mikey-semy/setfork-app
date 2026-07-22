import { describe, expect, it } from 'vitest'
import { isHandleShapeValid, normalizeHandle } from '@/shared/auth/handle'

describe('normalizeHandle', () => {
  it('обрезает, нижний регистр, снимает ведущий @', () => {
    expect(normalizeHandle('  @MikeSmith ')).toBe('mikesmith')
    expect(normalizeHandle('@@dbl')).toBe('dbl')
    expect(normalizeHandle('Plain')).toBe('plain')
  })
})

describe('isHandleShapeValid', () => {
  it('валидный ник: 3–30 a-z0-9-', () => {
    expect(isHandleShapeValid('mike')).toBe(true)
    expect(isHandleShapeValid('mike-99')).toBe(true)
  })
  it('слишком короткий / кривые символы → false', () => {
    expect(isHandleShapeValid('ab')).toBe(false)
    expect(isHandleShapeValid('Mike')).toBe(false) // верхний регистр (нормализовать до)
    expect(isHandleShapeValid('a b')).toBe(false)
    expect(isHandleShapeValid('емодзи')).toBe(false)
  })
  it('зарезервированные слова → false', () => {
    expect(isHandleShapeValid('admin')).toBe(false)
    expect(isHandleShapeValid('ghost')).toBe(false)
    expect(isHandleShapeValid('settings')).toBe(false)
  })
})
