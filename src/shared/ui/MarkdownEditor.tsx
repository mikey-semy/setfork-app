'use client'
import { type KeyboardEvent, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { AtSign, Bold, Code, Heading, ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, Paperclip, Quote, SmilePlus, Strikethrough } from 'lucide-react'
import emojiData from '@emoji-mart/data'
import { Markdown } from './Markdown'

const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })

type Props = {
  name: string
  defaultValue?: string
  placeholder?: string
  rows?: number
  maxLength?: number
  autoFocus?: boolean
  lang?: string
  className?: string
  /** Репо для #-reference (кросс-ссылки на issue): включает `#`-автодополнение. */
  refScope?: { owner: string; slug: string }
}

type MentionUser = { handle: string; avatarUrl: string | null }
type IssueHit = { number: number; title: string; status: string }
const btn = 'inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink'

// Богатый markdown-редактор: тулбар (группы+разделители), Write/Preview, эмодзи, @mention,
// картинки+вложения, Tab-отступ, undo/redo + горячие клавиши. Управляемая <textarea name>.
export function MarkdownEditor({ name, defaultValue = '', placeholder, rows = 6, maxLength, autoFocus, lang = 'en', className, refScope }: Props) {
  const [val, setVal] = useState(defaultValue)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [busy, setBusy] = useState(0)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [users, setUsers] = useState<MentionUser[]>([])
  const [mIdx, setMIdx] = useState(0)
  const [iref, setIref] = useState<{ start: number; query: string } | null>(null)
  const [issueHits, setIssueHits] = useState<IssueHit[]>([])
  const [iIdx, setIIdx] = useState(0)

  const ref = useRef<HTMLTextAreaElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchSeq = useRef(0)
  const irefSeq = useRef(0)
  const valRef = useRef(defaultValue) // «живое» значение (без задержки setState) для расчётов
  const hist = useRef({ stack: [defaultValue], idx: 0, at: 0, typing: false }) // история undo/redo
  const { resolvedTheme } = useTheme()
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

  const restore = (start: number, end: number) =>
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) {
        el.focus()
        el.setSelectionRange(start, end)
      }
    })

  // Записать состояние в историю. coalesce=true — печать сливается в один шаг за окно 500мс.
  function record(next: string, coalesce: boolean) {
    const h = hist.current
    if (h.idx < h.stack.length - 1) h.stack = h.stack.slice(0, h.idx + 1)
    const now = performance.now()
    if (coalesce && h.typing && now - h.at < 500) {
      h.stack[h.idx] = next
    } else {
      h.stack.push(next)
      if (h.stack.length > 300) h.stack.shift()
      h.idx = h.stack.length - 1
    }
    h.at = now
    h.typing = coalesce
  }

  // Программное изменение (тулбар/эмодзи/вставка): в состояние + историю (+ каретка).
  function apply(next: string, sel?: [number, number]) {
    valRef.current = next
    setVal(next)
    record(next, false)
    if (sel) restore(sel[0], sel[1])
  }

  function undo() {
    const h = hist.current
    if (h.idx <= 0) return
    h.idx--
    const v = h.stack[h.idx]
    valRef.current = v
    setVal(v)
    h.typing = false
    restore(v.length, v.length)
  }
  function redo() {
    const h = hist.current
    if (h.idx >= h.stack.length - 1) return
    h.idx++
    const v = h.stack[h.idx]
    valRef.current = v
    setVal(v)
    h.typing = false
    restore(v.length, v.length)
  }

  function surround(before: string, after = before, ph = '') {
    const el = ref.current
    if (!el) return
    const cur = valRef.current
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = cur.slice(s, e) || ph
    apply(cur.slice(0, s) + before + sel + after + cur.slice(e), [s + before.length, s + before.length + sel.length])
  }

  function linePrefix(make: (i: number) => string) {
    const el = ref.current
    if (!el) return
    const cur = valRef.current
    const s = el.selectionStart
    const e = el.selectionEnd
    const start = cur.lastIndexOf('\n', s - 1) + 1
    const block = cur.slice(start, e)
    const replaced = block.split('\n').map((l, i) => make(i) + l).join('\n')
    apply(cur.slice(0, start) + replaced + cur.slice(e), [start, start + replaced.length])
  }

  function insertAt(text: string) {
    const el = ref.current
    if (!el) return
    const cur = valRef.current
    const s = el.selectionStart
    const e = el.selectionEnd
    apply(cur.slice(0, s) + text + cur.slice(e), [s + text.length, s + text.length])
  }

  async function uploadFiles(files: File[]) {
    for (const file of files) {
      const isImg = file.type.startsWith('image/')
      const token = `${isImg ? '!' : ''}[${L('загрузка', 'uploading')} ${file.name}…](…${Math.round(performance.now())})`
      insertAt(token + '\n')
      setBusy((b) => b + 1)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => ({}))) as { url?: string; kind?: string; name?: string; error?: string }
        const md = res.ok && data.url ? (data.kind === 'image' ? `![${data.name ?? file.name}](${data.url})` : `[📎 ${data.name ?? file.name}](${data.url})`) : `*(${data.error ?? L('загрузка не удалась', 'upload failed')})*`
        apply(valRef.current.replace(token, md))
      } catch {
        apply(valRef.current.replace(token, `*(${L('загрузка не удалась', 'upload failed')})*`))
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  // ── @mention ──
  function detectMention(value: string, caret: number) {
    const m = /(?:^|\s)@([\w-]{0,30})$/.exec(value.slice(0, caret))
    if (!m) return null
    return { start: caret - m[1].length - 1, query: m[1] }
  }
  async function runMentionSearch(query: string) {
    if (!query) return setUsers([])
    const seq = ++searchSeq.current
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
      const data = (await res.json()) as MentionUser[]
      if (seq === searchSeq.current) {
        setUsers(Array.isArray(data) ? data : [])
        setMIdx(0)
      }
    } catch {
      /* игнор */
    }
  }
  // ── #-reference (issue) ──
  function detectIssueRef(value: string, caret: number) {
    if (!refScope) return null
    const m = /(?:^|\s)#(\d{0,10})$/.exec(value.slice(0, caret))
    if (!m) return null
    return { start: caret - m[1].length - 1, query: m[1] }
  }
  async function runIssueSearch(query: string) {
    if (!refScope) return
    const seq = ++irefSeq.current
    try {
      const res = await fetch(`/api/issues/search?owner=${encodeURIComponent(refScope.owner)}&slug=${encodeURIComponent(refScope.slug)}&q=${encodeURIComponent(query)}`)
      const data = (await res.json()) as IssueHit[]
      if (seq === irefSeq.current) {
        setIssueHits(Array.isArray(data) ? data : [])
        setIIdx(0)
      }
    } catch {
      /* игнор */
    }
  }
  function pickIssueRef(hit: IssueHit) {
    if (!iref) return
    const end = iref.start + 1 + iref.query.length
    const ins = `#${hit.number} `
    const caret = iref.start + ins.length
    apply(valRef.current.slice(0, iref.start) + ins + valRef.current.slice(end), [caret, caret])
    setIref(null)
    setIssueHits([])
  }

  function onChange(value: string) {
    valRef.current = value
    setVal(value)
    record(value, true)
    const caret = ref.current?.selectionStart ?? value.length
    const m = detectMention(value, caret)
    setMention(m)
    if (m) void runMentionSearch(m.query)
    else setUsers([])
    const r = detectIssueRef(value, caret)
    setIref(r)
    if (r) void runIssueSearch(r.query)
    else setIssueHits([])
  }
  function pickMention(u: MentionUser) {
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const caret = mention.start + u.handle.length + 2
    apply(valRef.current.slice(0, mention.start) + `@${u.handle} ` + valRef.current.slice(end), [caret, caret])
    setMention(null)
    setUsers([])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 1) навигация по @mention
    if (mention && users.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMIdx((i) => (i + 1) % users.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMIdx((i) => (i - 1 + users.length) % users.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(users[mIdx])
        return
      }
      if (e.key === 'Escape') {
        setMention(null)
        setUsers([])
        return
      }
    }
    // 1b) навигация по #-reference
    if (iref && issueHits.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIIdx((i) => (i + 1) % issueHits.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIIdx((i) => (i - 1 + issueHits.length) % issueHits.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickIssueRef(issueHits[iIdx])
        return
      }
      if (e.key === 'Escape') {
        setIref(null)
        setIssueHits([])
        return
      }
    }
    // 2) горячие клавиши
    const mod = e.metaKey || e.ctrlKey
    if (mod) {
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
        return
      }
      if (k === 'b') {
        e.preventDefault()
        surround('**', '**', L('текст', 'text'))
        return
      }
      if (k === 'i') {
        e.preventDefault()
        surround('_', '_', L('текст', 'text'))
        return
      }
      if (k === 'k') {
        e.preventDefault()
        surround('[', '](url)', L('текст', 'text'))
        return
      }
    }
    // 3) Tab-отступ / снятие
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const cur = valRef.current
      const s = el.selectionStart
      const en = el.selectionEnd
      const lineStart = cur.lastIndexOf('\n', s - 1) + 1
      if (e.shiftKey) {
        const block = cur.slice(lineStart, en)
        const dedented = block.replace(/^ {1,2}/gm, '')
        apply(cur.slice(0, lineStart) + dedented + cur.slice(en), [Math.max(lineStart, s - 2), en - (block.length - dedented.length)])
      } else if (s !== en) {
        const block = cur.slice(lineStart, en)
        const indented = block.replace(/^/gm, '  ')
        apply(cur.slice(0, lineStart) + indented + cur.slice(en), [s + 2, en + (indented.length - block.length)])
      } else {
        insertAt('  ')
      }
    }
  }

  const groups: { icon: typeof Bold; t: string; run: () => void }[][] = [
    [
      { icon: Heading, t: L('заголовок', 'heading'), run: () => linePrefix(() => '### ') },
      { icon: Bold, t: `${L('жирный', 'bold')} (Ctrl+B)`, run: () => surround('**', '**', L('текст', 'text')) },
      { icon: Italic, t: `${L('курсив', 'italic')} (Ctrl+I)`, run: () => surround('_', '_', L('текст', 'text')) },
      { icon: Strikethrough, t: L('зачёркнутый', 'strikethrough'), run: () => surround('~~', '~~', L('текст', 'text')) },
    ],
    [
      { icon: Quote, t: L('цитата', 'quote'), run: () => linePrefix(() => '> ') },
      { icon: Code, t: L('код', 'code'), run: () => surround('`', '`', 'code') },
      { icon: Link2, t: `${L('ссылка', 'link')} (Ctrl+K)`, run: () => surround('[', '](url)', L('текст', 'text')) },
    ],
    [
      { icon: List, t: L('список', 'bulleted list'), run: () => linePrefix(() => '- ') },
      { icon: ListOrdered, t: L('нумерованный', 'numbered list'), run: () => linePrefix((i) => `${i + 1}. `) },
      { icon: ListChecks, t: L('чек-лист', 'task list'), run: () => linePrefix(() => '- [ ] ') },
    ],
  ]

  return (
    <div className={`overflow-hidden rounded-md border border-border bg-surface ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-2 px-1.5 py-1">
        <div className="mr-1 flex overflow-hidden rounded border border-border">
          {(['write', 'preview'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`px-2.5 py-1 text-[12.5px] font-semibold ${tab === k ? 'bg-surface text-ink' : 'bg-surface-2 text-muted hover:text-ink'}`}>
              {k === 'write' ? L('Написать', 'Write') : L('Просмотр', 'Preview')}
            </button>
          ))}
        </div>

        {tab === 'write' && (
          <div className="flex flex-wrap items-center gap-0.5">
            {groups.map((group, gi) => (
              <div key={gi} className="flex items-center gap-0.5">
                {gi > 0 && <span className="mx-1 h-4 w-px bg-border" />}
                {group.map((tool, i) => (
                  <button key={i} type="button" title={tool.t} aria-label={tool.t} onClick={tool.run} className={btn}>
                    <tool.icon size={15} />
                  </button>
                ))}
              </div>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <button type="button" title={L('картинка', 'image')} aria-label={L('картинка', 'image')} onClick={() => imgInput.current?.click()} className={btn}>
              <ImageIcon size={15} />
            </button>
            <button type="button" title={L('файл', 'attach file')} aria-label={L('файл', 'attach file')} onClick={() => fileInput.current?.click()} className={btn}>
              <Paperclip size={15} />
            </button>
            <button type="button" title={L('упомянуть', 'mention')} aria-label={L('упомянуть', 'mention')} onClick={() => insertAt('@')} className={btn}>
              <AtSign size={15} />
            </button>
            <span className="relative inline-flex">
              <button type="button" title={L('эмодзи', 'emoji')} aria-label={L('эмодзи', 'emoji')} onClick={() => setEmojiOpen((o) => !o)} className={btn}>
                <SmilePlus size={15} />
              </button>
              {emojiOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
                  <div className="absolute right-0 top-8 z-20">
                    <EmojiPicker
                      data={emojiData}
                      locale={lang === 'ru' ? 'ru' : 'en'}
                      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                      previewPosition="none"
                      skinTonePosition="none"
                      onEmojiSelect={(ev: { native?: string }) => {
                        if (ev.native) insertAt(ev.native)
                        setEmojiOpen(false)
                      }}
                    />
                  </div>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      <input ref={imgInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) uploadFiles(Array.from(e.target.files)); e.target.value = '' }} />
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) uploadFiles(Array.from(e.target.files)); e.target.value = '' }} />

      <div className={`relative ${tab === 'preview' ? 'hidden' : ''}`}>
        <textarea
          ref={ref}
          name={name}
          value={val}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => { setMention(null); setIref(null) }, 150)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              uploadFiles(files)
            }
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files)
            if (files.length) {
              e.preventDefault()
              uploadFiles(files)
            }
          }}
          className="w-full resize-y bg-surface px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted"
        />

        {mention && users.length > 0 && (
          <div className="absolute bottom-2 left-2 z-20 w-64 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
            {users.map((u, i) => (
              <button
                key={u.handle}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(u)
                }}
                onMouseEnter={() => setMIdx(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${i === mIdx ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-surface-2" />}
                <span className="font-medium">@{u.handle}</span>
              </button>
            ))}
          </div>
        )}

        {/* #-reference автодополнение */}
        {iref && issueHits.length > 0 && (
          <div className="absolute bottom-2 left-2 z-20 w-72 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
            {issueHits.map((h, i) => (
              <button
                key={h.number}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickIssueRef(h)
                }}
                onMouseEnter={() => setIIdx(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${i === iIdx ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
              >
                <span className={`font-mono ${h.status === 'closed' ? 'text-accent' : 'text-ok'}`}>#{h.number}</span>
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === 'preview' && (
        <div className="min-h-[80px] px-3 py-2.5">
          {val.trim() ? <Markdown>{val}</Markdown> : <p className="text-[13px] italic text-muted">{L('Нечего показывать', 'Nothing to preview')}</p>}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border bg-surface-2 px-3 py-1.5 text-[11.5px] text-muted">
        <span>{L('Поддерживается Markdown', 'Markdown supported')}</span>
        <span className="text-border">·</span>
        <button type="button" onClick={() => fileInput.current?.click()} className="hover:text-ink">
          {L('вставьте, перетащите или прикрепите файлы', 'paste, drop, or attach files')}
        </button>
        {busy > 0 && <span className="text-accent">· {L('загрузка…', 'uploading…')}</span>}
      </div>
    </div>
  )
}
