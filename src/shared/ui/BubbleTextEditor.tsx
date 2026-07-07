'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { Bold, Code, Heading, Italic, Link2, List, ListOrdered, Quote, SmilePlus, Strikethrough } from 'lucide-react'
import emojiData from '@emoji-mart/data'
import { caretCoords } from './caret-coords'

const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })
const tbtn = 'grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink'

// Редактор текста со ВСПЛЫВАЮЩЕЙ (bubble) панелью: появляется, пока работаешь с
// текстом блока (фокус/выделение), плавает у курсора и НЕ перекрывает текст.
// Форматирование + эмодзи. БЕЗ картинок/файлов (для них отдельные блоки).
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
  const [emojiOpen, setEmojiOpen] = useState(false)
  const savedSel = useRef<[number, number]>([0, 0]) // выделение до открытия эмодзи-пикера
  const { resolvedTheme } = useTheme()
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

  // Позиция панели у текущего курсора/выделения (флип: над строкой либо под ней).
  function refresh() {
    const el = ref.current
    if (!el) return
    const TOOLBAR_H = 34
    const GAP = 6
    const start = caretCoords(el, el.selectionStart)
    const startTop = start.top - el.scrollTop
    let top: number
    if (startTop >= TOOLBAR_H + GAP) {
      top = startTop - TOOLBAR_H - GAP
    } else {
      const end = caretCoords(el, el.selectionEnd)
      top = end.top - el.scrollTop + end.height + GAP
    }
    setBubble({ top, left: Math.max(4, Math.min(start.left, el.clientWidth - 280)) })
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

  function linePrefix(make: (i: number) => string) {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const start = value.lastIndexOf('\n', s - 1) + 1
    const block = value.slice(start, e)
    const replaced = block.split('\n').map((l, i) => make(i) + l).join('\n')
    apply(value.slice(0, start) + replaced + value.slice(e), start, start + replaced.length)
  }

  function insertAtRange(text: string, s: number, e: number) {
    apply(value.slice(0, s) + text + value.slice(e), s + text.length, s + text.length)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); surround('**', '**', L('текст', 'text')) }
    else if (k === 'i') { e.preventDefault(); surround('_', '_', L('текст', 'text')) }
    else if (k === 'k') { e.preventDefault(); surround('[', '](url)', L('текст', 'text')) }
  }

  const groups: { icon: typeof Bold; t: string; run: () => void }[][] = [
    [
      { icon: Heading, t: L('заголовок', 'heading'), run: () => linePrefix(() => '### ') },
      { icon: Bold, t: `${L('жирный', 'bold')} (Ctrl+B)`, run: () => surround('**', '**', L('текст', 'text')) },
      { icon: Italic, t: `${L('курсив', 'italic')} (Ctrl+I)`, run: () => surround('_', '_', L('текст', 'text')) },
      { icon: Strikethrough, t: L('зачёркнутый', 'strikethrough'), run: () => surround('~~', '~~', L('текст', 'text')) },
    ],
    [
      { icon: Code, t: L('код', 'code'), run: () => surround('`', '`', 'code') },
      { icon: Link2, t: `${L('ссылка', 'link')} (Ctrl+K)`, run: () => surround('[', '](url)', L('текст', 'text')) },
      { icon: Quote, t: L('цитата', 'quote'), run: () => linePrefix(() => '> ') },
    ],
    [
      { icon: List, t: L('список', 'bulleted list'), run: () => linePrefix(() => '- ') },
      { icon: ListOrdered, t: L('нумерованный', 'numbered list'), run: () => linePrefix((i) => `${i + 1}. `) },
    ],
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
        onFocus={refresh}
        onClick={refresh}
        onSelect={refresh}
        onKeyUp={refresh}
        onScroll={refresh}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => { if (!emojiOpen) setBubble(null) }, 150)}
        className="min-h-[72px] w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none focus:border-border-strong"
      />
      {bubble && (
        <div
          className="absolute z-30 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-lg"
          style={{ top: Math.max(0, bubble.top), left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()} // не терять фокус/выделение при клике по кнопке
        >
          {groups.map((group, gi) => (
            <div key={gi} className="flex items-center gap-0.5">
              {gi > 0 && <span className="mx-0.5 h-4 w-px bg-border" />}
              {group.map((tool, i) => (
                <button key={i} type="button" title={tool.t} aria-label={tool.t} onClick={tool.run} className={tbtn}>
                  <tool.icon size={14} />
                </button>
              ))}
            </div>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title={L('эмодзи', 'emoji')}
            aria-label={L('эмодзи', 'emoji')}
            onClick={() => {
              const el = ref.current
              if (el) savedSel.current = [el.selectionStart, el.selectionEnd]
              setEmojiOpen(true)
            }}
            className={tbtn}
          >
            <SmilePlus size={14} />
          </button>
        </div>
      )}
      {emojiOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={() => setEmojiOpen(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <EmojiPicker
                data={emojiData}
                locale={lang === 'ru' ? 'ru' : 'en'}
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                previewPosition="none"
                skinTonePosition="none"
                perLine={8}
                onEmojiSelect={(ev: { native?: string }) => {
                  if (ev.native) insertAtRange(ev.native, savedSel.current[0], savedSel.current[1])
                  setEmojiOpen(false)
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
