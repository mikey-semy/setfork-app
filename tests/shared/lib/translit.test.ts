import { describe, expect, it } from 'vitest'
import { detectTextLang, translitRu } from '@/shared/lib/translit'
import { slugify } from '@/features/library/slug'

describe('slugify с транслитерацией', () => {
  it('русский заголовок → латинский слаг (раньше давал «-»)', () => {
    expect(slugify('Домашнее маршмеллоу')).toBe('domashnee-marshmellou')
    expect(slugify('Топ-5 книг по Rust')).toBe('top-5-knig-po-rust')
  })

  it('латиница как раньше; пусто → list', () => {
    expect(slugify('My Cool List!')).toBe('my-cool-list')
    expect(slugify('!!!')).toBe('list')
  })
})

describe('detectTextLang', () => {
  it('кириллица → ru, латиница → en, смесь по доле', () => {
    expect(detectTextLang('Домашнее маршмеллоу')).toBe('ru')
    expect(detectTextLang('Homemade marshmallow')).toBe('en')
    expect(detectTextLang('Setup nginx на сервере с нуля')).toBe('ru')
    expect(detectTextLang('')).toBe('en')
    expect(detectTextLang('123 456')).toBe('en')
  })
})

describe('translitRu', () => {
  it('щ/ю/я и твёрдый знак', () => {
    expect(translitRu('Щука объелась')).toBe('schuka obelas')
  })
})
