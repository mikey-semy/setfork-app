'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { Bold, Code, Heading, Italic, Link2, List, ListOrdered, Quote, SmilePlus, Strikethrough } from 'lucide-react'
import emojiData from '@emoji-mart/data'

const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })
const btn = 'grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink'

// Компактный редактор текста с ПОСТОЯННОЙ панелью форматирования (работает на весь
// текст блока) + эмодзи. БЕЗ картинок/файлов — для них отдельные блоки (image/video).
// Управляемый (value/onChange), рендерится Markdown'ом на странице.
export function RichTextArea({
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
  const [emojiOpen, setEmojiOpen] = useState(false)
  const { resolvedTheme } = useTheme()
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

  function apply(next: string, selStart: number, selEnd: number) {
    onChange(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(selStart, selEnd)
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

  function insertAt(text: string) {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
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
    <div className="overflow-hidden rounded-md border border-border bg-surface-2">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface px-1 py-1">
        {groups.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <span className="mx-0.5 h-4 w-px bg-border" />}
            {group.map((tool, i) => (
              <button key={i} type="button" title={tool.t} aria-label={tool.t} onClick={tool.run} className={btn}>
                <tool.icon size={14} />
              </button>
            ))}
          </div>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border" />
        <span className="inline-flex">
          <button type="button" title={L('эмодзи', 'emoji')} aria-label={L('эмодзи', 'emoji')} onClick={() => setEmojiOpen((o) => !o)} className={btn}>
            <SmilePlus size={14} />
          </button>
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
                      if (ev.native) insertAt(ev.native)
                      setEmojiOpen(false)
                    }}
                  />
                </div>
              </div>,
              document.body,
            )}
        </span>
      </div>
      <textarea
        ref={ref}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-[64px] w-full resize-y bg-surface-2 px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-muted"
      />
    </div>
  )
}
