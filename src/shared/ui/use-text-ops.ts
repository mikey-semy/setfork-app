'use client'
import { type KeyboardEvent, type RefObject } from 'react'
import { indentLines, insertText, prefixLines, surroundText, type TextEdit } from './text-ops'

/** Что редактор умеет делать с текстом — этим же набором питается тулбар. */
export interface TextOps {
  surround: (before: string, after?: string, placeholder?: string) => void
  linePrefix: (make: (i: number) => string) => void
  insertAt: (text: string) => void
  /** Вставка в ЗАПОМНЕННОЕ место (пикер эмодзи забирает фокус — каретки уже нет). */
  insertAtRange: (text: string, start: number, end: number) => void
  /** Tab/Shift+Tab. Возвращает true, если событие обработано. */
  indent: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Ctrl/Cmd+B, +I, +K. Возвращает true, если событие обработано. */
  hotkey: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

/**
 * Правка текста в textarea: чистые операции из text-ops.ts, привязанные к полю и к
 * способу записать результат. Оба редактора отличаются только этим способом —
 * контролируемый BubbleTextEditor пишет в проп, MarkdownEditor ещё и в свою историю.
 */
export function useTextOps(ctx: {
  ref: RefObject<HTMLTextAreaElement | null>
  /** Текущий текст: у контролируемого поля — проп, у редактора с историей — «живое» значение. */
  read: () => string
  apply: (next: string, selStart: number, selEnd: number) => void
  /** Чем заменить пустое выделение («текст» из словаря) — язык знает вызывающий. */
  placeholder: string
}): TextOps {
  const { ref, read, apply, placeholder } = ctx

  const run = (edit: (value: string, start: number, end: number) => TextEdit) => {
    const el = ref.current
    if (!el) return
    const { text, selStart, selEnd } = edit(read(), el.selectionStart, el.selectionEnd)
    apply(text, selStart, selEnd)
  }

  const surround: TextOps['surround'] = (before, after = before, ph = '') =>
    run((v, s, e) => surroundText(v, s, e, before, after, ph))

  return {
    surround,
    linePrefix: (make) => run((v, s, e) => prefixLines(v, s, e, make)),
    insertAt: (text) => run((v, s, e) => insertText(v, s, e, text)),
    insertAtRange: (text, start, end) => {
      const { text: next, selStart, selEnd } = insertText(read(), start, end, text)
      apply(next, selStart, selEnd)
    },
    indent: (e) => {
      if (e.key !== 'Tab') return false
      e.preventDefault()
      run((v, s, en) => indentLines(v, s, en, e.shiftKey))
      return true
    },
    hotkey: (e) => {
      if (!(e.metaKey || e.ctrlKey)) return false
      const k = e.key.toLowerCase()
      if (k === 'b') surround('**', '**', placeholder)
      else if (k === 'i') surround('_', '_', placeholder)
      else if (k === 'k') surround('[', '](url)', placeholder)
      else return false
      e.preventDefault()
      return true
    },
  }
}
