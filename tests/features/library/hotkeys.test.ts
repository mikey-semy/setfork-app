import { describe, expect, it } from 'vitest'
import { commandFor, isFieldTarget } from '@/features/library/list-editor/hotkeys'

/**
 * КЛАВИАТУРА РЕДАКТОРА НЕ ОТБИРАЕТ У БРАУЗЕРА ЕГО ОТМЕНУ.
 *
 * Ctrl+Z в поле ввода отматывает НАБРАННЫЙ ТЕКСТ — это работа браузера, и подменять её
 * отменой структурной правки значит терять слова человека. А вот Alt+↑/↓ обязаны
 * работать и в поле: это единственный способ двигать блок с клавиатуры.
 */
const press = (over: Partial<Parameters<typeof commandFor>[0]>) =>
  commandFor({ key: 'z', mod: false, shift: false, alt: false, inField: false, ...over })

describe('горячие клавиши редактора', () => {
  it('Ctrl+Z вне поля — отмена, Ctrl+Shift+Z и Ctrl+Y — повтор', () => {
    expect(press({ key: 'z', mod: true })).toEqual({ kind: 'undo' })
    expect(press({ key: 'z', mod: true, shift: true })).toEqual({ kind: 'redo' })
    expect(press({ key: 'y', mod: true })).toEqual({ kind: 'redo' })
  })

  it('⌘ равнозначен Ctrl, регистр клавиши не важен', () => {
    expect(press({ key: 'Z', mod: true })).toEqual({ kind: 'undo' })
  })

  it('в поле ввода отмену не перехватываем — там браузерная', () => {
    expect(press({ key: 'z', mod: true, inField: true })).toBeNull()
    expect(press({ key: 'y', mod: true, inField: true })).toBeNull()
  })

  it('Alt+↑/↓ двигают блок — в том числе из поля ввода', () => {
    expect(press({ key: 'ArrowUp', alt: true })).toEqual({ kind: 'move', dir: -1 })
    expect(press({ key: 'ArrowDown', alt: true, inField: true })).toEqual({ kind: 'move', dir: 1 })
  })

  it('стрелки без Alt и обычные буквы редактора не касаются', () => {
    expect(press({ key: 'ArrowUp' })).toBeNull()
    expect(press({ key: 'z' })).toBeNull()
    expect(press({ key: 'Enter', mod: true })).toBeNull()
  })
})

describe('что считается полем со своей отменой', () => {
  it('input и textarea — поля', () => {
    expect(isFieldTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isFieldTarget({ tagName: 'TEXTAREA' })).toBe(true)
  })

  it('редактор кода — тоже поле, хотя это div', () => {
    // CodeMirror правит обычный div с contenteditable. Пока правило смотрело на
    // тег, Ctrl+Z внутри текста канона откатывал СТРУКТУРУ БЛОКОВ вместо
    // набранного — то есть отбирал у человека его же правку.
    expect(isFieldTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('обычная разметка полем не считается', () => {
    expect(isFieldTarget({ tagName: 'DIV' })).toBe(false)
    expect(isFieldTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false)
  })
})
