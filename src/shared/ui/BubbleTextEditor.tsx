'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { AtSign, MoreHorizontal, SmilePlus } from 'lucide-react'
import { markdownToolbarGroups } from './markdown-toolbar'
import emojiData from '@emoji-mart/data'
import { caretCoords } from './caret-coords'
import { Tooltip } from './Tooltip'
import { Popover, PopoverAnchor, PopoverContent } from './popover'

const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })
const tbtn = 'grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink'
type MentionUser = { handle: string; avatarUrl: string | null }

// Редактор текста со ВСПЛЫВАЮЩЕЙ (bubble) панелью: появляется, пока работаешь с
// текстом (фокус/выделение), плавает у курсора и НЕ перекрывает текст. Полный набор
// форматирования + список + эмодзи + @упоминания. БЕЗ картинок/файлов — для них
// отдельные блоки. Управляемый (value/onChange), рендерится Markdown'ом.
export function BubbleTextEditor({
  value,
  onChange,
  placeholder,
  rows = 3,
  lang = 'en',
  ariaLabel,
  singleLine = false,
  mono = false,
  bare = false,
  className,
  textareaClassName,
  trailing,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  lang?: 'ru' | 'en'
  ariaLabel?: string
  singleLine?: boolean // одно-строчное поле (заголовок/команда/…) — Enter не переносит
  mono?: boolean // моноширинный (для команды)
  bare?: boolean // без рамки/фона (для инлайн-заголовка секции)
  className?: string // для обёртки (напр. flex-1 в строке)
  textareaClassName?: string // доп. классы поля (напр. font-semibold у секции)
  trailing?: ReactNode // кнопка/иконка внутри поля справа (напр. авто-генерация)
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false) // «⋯»: редкие инструменты — панель влезает в мобильный экран
  const savedSel = useRef<[number, number]>([0, 0])
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [users, setUsers] = useState<MentionUser[]>([])
  const [mIdx, setMIdx] = useState(0)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const searchSeq = useRef(0)
  const { resolvedTheme } = useTheme()
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

  function coordsAt(pos: number): { top: number; left: number } | null {
    const el = ref.current
    if (!el) return null
    const c = caretCoords(el, pos)
    return { top: c.top - el.scrollTop, left: Math.min(Math.max(0, c.left), Math.max(0, el.clientWidth - 240)) }
  }

  // Позиция панели у текущего курсора/выделения (флип: над строкой либо под ней).
  function refresh() {
    const el = ref.current
    if (!el) return
    if (mention) { setBubble(null); return } // при активном @-меню панель прячем
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
    setBubble({ top, left: Math.max(4, Math.min(start.left, el.clientWidth - 300)) })
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

  // ── @mention ──
  function detectMention(v: string, caret: number) {
    const m = /(?:^|\s)@([\w-]{0,30})$/.exec(v.slice(0, caret))
    return m ? { start: caret - m[1].length - 1, query: m[1] } : null
  }
  async function runMentionSearch(query: string) {
    const seq = ++searchSeq.current
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
      const data = (await res.json()) as MentionUser[]
      if (seq === searchSeq.current) {
        setUsers(Array.isArray(data) ? data.slice(0, 8) : [])
        setMIdx(0)
      }
    } catch {
      /* игнор */
    }
  }
  function pickMention(u: MentionUser) {
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const caret = mention.start + u.handle.length + 2
    apply(value.slice(0, mention.start) + `@${u.handle} ` + value.slice(end), caret, caret)
    setMention(null)
    setUsers([])
  }

  function onChangeText(v: string) {
    onChange(v)
    const caret = ref.current?.selectionStart ?? v.length
    const m = detectMention(v, caret)
    setMention(m)
    if (m) {
      setAnchor(coordsAt(caret))
      void runMentionSearch(m.query)
      setBubble(null)
    } else {
      setUsers([])
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && users.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMIdx((i) => (i + 1) % users.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMIdx((i) => (i - 1 + users.length) % users.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(users[mIdx]); return }
      if (e.key === 'Escape') { setMention(null); setUsers([]); return }
    }
    if (singleLine && e.key === 'Enter') { e.preventDefault(); return } // одно-строчное поле
    if (!(e.metaKey || e.ctrlKey)) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); surround('**', '**', L('текст', 'text')) }
    else if (k === 'i') { e.preventDefault(); surround('_', '_', L('текст', 'text')) }
    else if (k === 'k') { e.preventDefault(); surround('[', '](url)', L('текст', 'text')) }
  }

  const groups = markdownToolbarGroups({ L, surround, linePrefix })

  return (
    <div className={`relative ${className ?? ''}`}>
      <textarea
        ref={ref}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={singleLine ? 1 : rows}
        onChange={(e) => onChangeText(e.target.value)}
        onFocus={refresh}
        onClick={refresh}
        onSelect={refresh}
        onKeyUp={refresh}
        onScroll={refresh}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => { if (!emojiOpen) { setBubble(null); setMention(null); setMoreOpen(false) } }, 150)}
        className={`w-full text-[0.8125rem] leading-relaxed text-ink outline-hidden ${
          bare ? 'resize-none overflow-hidden bg-transparent' : 'rounded-md border border-border bg-surface-2 px-3 py-2 focus:border-border-strong'
        } ${singleLine && !bare ? 'resize-none overflow-hidden' : bare ? '' : 'min-h-[4.5rem] resize-y'} ${trailing ? 'pr-9' : ''} ${mono ? 'font-mono text-[0.78125rem]' : ''} ${textareaClassName ?? ''}`}
      />
      {trailing && <div className="absolute right-1.5 top-1.5">{trailing}</div>}

      {bubble && !mention && (
        <div
          className="absolute z-30 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-lg transition-[top,left] duration-150 ease-out motion-reduce:transition-none"
          style={{ top: Math.max(0, bubble.top), left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Инлайн — только базовое форматирование (первая группа). Остальное в «⋯»:
              13 кнопок в ряд не влезали в мобильный экран. */}
          {(groups[0] ?? []).map((tool, i) => (
            <Tooltip key={i} label={tool.t}>
              <button type="button" aria-label={tool.t} onClick={tool.run} className={tbtn}>
                <tool.icon size={14} />
              </button>
            </Tooltip>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <div className="relative">
            {/* Пикер эмодзи — ЯКОРНЫЙ (не по центру экрана). Якорь — кнопка «ещё»:
                она остаётся смонтированной, в отличие от самой кнопки эмодзи, которая
                живёт в закрывающемся меню. Открытием управляет emojiOpen. */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <Tooltip label={L('ещё', 'more')}>
                <PopoverAnchor asChild>
                  <button
                    type="button"
                    aria-label={L('ещё', 'more')}
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((o) => !o)}
                    className={tbtn}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </PopoverAnchor>
              </Tooltip>
              <PopoverContent side="bottom" align="end" className="border-0 bg-transparent p-0 shadow-none">
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
              </PopoverContent>
            </Popover>
            {moreOpen && (
              // Сетка с переносом: меню тоже не должно быть шире экрана.
              <div className="absolute right-0 top-full z-40 mt-1 flex w-max max-w-[11.75rem] flex-wrap items-center gap-0.5 rounded-md border border-border bg-surface p-1 shadow-lg">
                {groups.slice(1).flat().map((tool, i) => (
                  <Tooltip key={i} label={tool.t}>
                    <button type="button" aria-label={tool.t} onClick={() => { tool.run(); setMoreOpen(false) }} className={tbtn}>
                      <tool.icon size={14} />
                    </button>
                  </Tooltip>
                ))}
                <Tooltip label={L('упомянуть', 'mention')}>
                  <button
                    type="button"
                    aria-label={L('упомянуть', 'mention')}
                    onClick={() => {
                      insertAtRange('@', ref.current?.selectionStart ?? value.length, ref.current?.selectionEnd ?? value.length)
                      setMoreOpen(false)
                    }}
                    className={tbtn}
                  >
                    <AtSign size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={L('эмодзи', 'emoji')}>
                  <button
                    type="button"
                    aria-label={L('эмодзи', 'emoji')}
                    onClick={() => {
                      const el = ref.current
                      if (el) savedSel.current = [el.selectionStart, el.selectionEnd]
                      setMoreOpen(false)
                      setEmojiOpen(true)
                    }}
                    className={tbtn}
                  >
                    <SmilePlus size={14} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      )}

      {/* @mention автодополнение */}
      {mention && users.length > 0 && (
        <div className="absolute z-40 max-h-52 w-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg" style={{ top: (anchor?.top ?? 0) + 20, left: anchor?.left ?? 8 }}>
          {users.map((u, i) => (
            <button
              key={u.handle}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pickMention(u) }}
              onMouseEnter={() => setMIdx(i)}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8125rem] ${i === mIdx ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-surface-2" />}
              <span className="font-medium">@{u.handle}</span>
            </button>
          ))}
        </div>
      )}

    </div>
  )
}
