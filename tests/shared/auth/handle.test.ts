import { describe, expect, it } from 'vitest'
import { HANDLE_RE, RESERVED_HANDLES, isHandleShapeValid, sanitizeHandleBase, translitRu } from '@/shared/auth/handle'

describe('translitRu', () => {
  it('транслитерирует кириллицу', () => {
    expect(translitRu('Иван Петров')).toBe('ivan petrov')
    expect(translitRu('Щука-Ёж')).toBe('schuka-ezh')
    expect(translitRu('объём')).toBe('obem')
  })

  it('латиницу и цифры не трогает (кроме lowercase)', () => {
    expect(translitRu('Mike-99')).toBe('mike-99')
  })
})

describe('sanitizeHandleBase', () => {
  it('валидный логин проходит как есть', () => {
    expect(sanitizeHandleBase('mikey-semy')).toBe('mikey-semy')
    expect(HANDLE_RE.test(sanitizeHandleBase('mikey-semy'))).toBe(true)
  })

  it('кириллическое имя → латиница с дефисами', () => {
    const h = sanitizeHandleBase('Иван Петров')
    expect(h).toBe('ivan-petrov')
    expect(HANDLE_RE.test(h)).toBe(true)
  })

  it('спецсимволы и подчёркивания схлопываются в дефис, края чистятся', () => {
    expect(sanitizeHandleBase('__cool__user__')).toBe('cool-user')
    expect(sanitizeHandleBase('a.b+c@d')).toBe('a-b-c-d')
  })

  it('длинное режется до 30 без хвостового дефиса', () => {
    const h = sanitizeHandleBase('x'.repeat(29) + '-tail')
    expect(h.length).toBeLessThanOrEqual(30)
    expect(h.endsWith('-')).toBe(false)
    expect(HANDLE_RE.test(h)).toBe(true)
  })

  it('слишком короткое или пустое → пустая строка', () => {
    expect(sanitizeHandleBase('ab')).toBe('')
    expect(sanitizeHandleBase('!!!')).toBe('')
    expect(sanitizeHandleBase('')).toBe('')
  })

  it('зарезервированные не входят в сам санитайзер (решает uniqueHandle)', () => {
    expect(RESERVED_HANDLES.has('admin')).toBe(true)
  })
})

describe('isHandleShapeValid — admin-ники нельзя занять (F9 privesc)', () => {
  it('ник из ADMIN_HANDLES отвергается сменой ника/регистрацией', () => {
    const prev = process.env.ADMIN_HANDLES
    process.env.ADMIN_HANDLES = 'mike, alice'
    try {
      expect(isHandleShapeValid('mike')).toBe(false)
      expect(isHandleShapeValid('alice')).toBe(false)
      // обычный ник (не в списке) остаётся валидным
      expect(isHandleShapeValid('bob')).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.ADMIN_HANDLES
      else process.env.ADMIN_HANDLES = prev
    }
  })
})
