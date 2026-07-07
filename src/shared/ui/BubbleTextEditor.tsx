'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Bold, Code, Heading, Italic, Link2, List, Quote, Strikethrough } from 'lucide-react'
import { caretCoords } from './caret-coords'

// Лёгкий редактор текста со ВСПЛЫВАЮЩЕЙ панелью форматирования: выдели текст —
// над ним появится мини-тулбар (Markdown-обёртки). БЕЗ картинок/файлов — для них
// есть отдельные блоки (image/video). Управляемый (value/onChange).
export function BubbleTextEditor({
  value,
  onChange,
  placeholder,
  rows = 3,
  lang = 'en',
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  lang?: 'ru' | 'en'
  ariaLabel?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

  function refresh() {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    if (s === e) {
      setBubble(null)
      return
    }
    const TOOLBAR_H = 34
    const GAP = 6
    const start = caretCoords(el, s)
    const startTop = start.top - el.scrollTop
    // Есть место сверху — панель НАД выделением; иначе — ПОД выделением (под
    // последней строкой), чтобы не перекрывать сам выделенный текст.
    let top: number
    if (startTop >= TOOLBAR_H + GAP) {
      top = startTop - TOOLBAR_H - GAP
    } else {
      const end = caretCoords(el, e)
      top = end.top - el.scrollTop + end.height + GAP
    }
    setBubble({ top, left: Math.max(4, Math.min(start.left, el.clientWidth - 244)) })
  }

  function apply(next: string, selStart: number, selEnd: number) {
    onChange(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(selStart, selEnd)
      refresh()
    })
  }

  function surround(before: string, after = before, ph = '') {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = value.slice(s, e) || ph
    apply(value.slice(0, s) + before + sel + after + value.slice(e), s + before.length, s + before.length + sel.length)
  }

  function linePrefix(prefix: string) {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const start = value.lastIndexOf('\n', s - 1) + 1
    const block = value.slice(start, e)
    const replaced = block.split('\n').map((l) => prefix + l).join('\n')
    apply(value.slice(0, start) + replaced + value.slice(e), start, start + replaced.length)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); surround('**', '**', L('текст', 'text')) }
    else if (k === 'i') { e.preventDefault(); surround('_', '_', L('текст', 'text')) }
    else if (k === 'k') { e.preventDefault(); surround('[', '](url)', L('текст', 'text')) }
  }

  const tools: { icon: typeof Bold; t: string; run: () => void }[] = [
    { icon: Bold, t: `${L('жирный', 'bold')} (Ctrl+B)`, run: () => surround('**', '**', L('текст', 'text')) },
    { icon: Italic, t: `${L('курсив', 'italic')} (Ctrl+I)`, run: () => surround('_', '_', L('текст', 'text')) },
    { icon: Strikethrough, t: L('зачёркнутый', 'strikethrough'), run: () => surround('~~', '~~', L('текст', 'text')) },
    { icon: Code, t: L('код', 'code'), run: () => surround('`', '`', 'code') },
    { icon: Link2, t: `${L('ссылка', 'link')} (Ctrl+K)`, run: () => surround('[', '](url)', L('текст', 'text')) },
    { icon: Heading, t: L('заголовок', 'heading'), run: () => linePrefix('### ') },
    { icon: List, t: L('список', 'list'), run: () => linePrefix('- ') },
    { icon: Quote, t: L('цитата', 'quote'), run: () => linePrefix('> ') },
  ]

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        onSelect={refresh}
        onMouseUp={refresh}
        onKeyUp={refresh}
        onScroll={refresh}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setBubble(null), 120)}
        className="min-h-[72px] w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none focus:border-border-strong"
      />
      {bubble && (
        <div
          className="absolute z-30 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-lg"
          style={{ top: Math.max(0, bubble.top - 38), left: bubble.left }}
          // Не терять выделение при клике по кнопке.
          onMouseDown={(e) => e.preventDefault()}
        >
          {tools.map((tl, i) => (
            <button
              key={i}
              type="button"
              title={tl.t}
              aria-label={tl.t}
              onClick={tl.run}
              className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink"
            >
              <tl.icon size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
