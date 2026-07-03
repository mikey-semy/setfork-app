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
}

type MentionUser = { handle: string; avatarUrl: string | null }
const btn = 'inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink'

// Богатый markdown-редактор: тулбар с группами, Write/Preview, эмодзи, @mention,
// картинки + вложения, Tab-отступ. Управляемая <textarea name> — сабмитится в <form action>.
export function MarkdownEditor({ name, defaultValue = '', placeholder, rows = 6, maxLength, autoFocus, lang = 'en', className }: Props) {
  const [val, setVal] = useState(defaultValue)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [busy, setBusy] = useState(0)
  // @mention
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [users, setUsers] = useState<MentionUser[]>([])
  const [mIdx, setMIdx] = useState(0)
  const searchSeq = useRef(0)

  const ref = useRef<HTMLTextAreaElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
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

  function surround(before: string, after = before, ph = '') {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = val.slice(s, e) || ph
    setVal(val.slice(0, s) + before + sel + after + val.slice(e))
    restore(s + before.length, s + before.length + sel.length)
  }

  function linePrefix(make: (i: number) => string) {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const start = val.lastIndexOf('\n', s - 1) + 1
    const block = val.slice(start, e)
    const replaced = block.split('\n').map((l, i) => make(i) + l).join('\n')
    setVal(val.slice(0, start) + replaced + val.slice(e))
    restore(start, start + replaced.length)
  }

  function insertAt(text: string) {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    setVal(val.slice(0, s) + text + val.slice(e))
    restore(s + text.length, s + text.length)
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
        setVal((v) => v.replace(token, md))
      } catch {
        setVal((v) => v.replace(token, `*(${L('загрузка не удалась', 'upload failed')})*`))
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  // ── @mention ──────────────────────────────────────────────
  function detectMention(value: string, caret: number) {
    const upto = value.slice(0, caret)
    const m = /(?:^|\s)@([\w-]{0,30})$/.exec(upto)
    if (!m) return null
    return { start: caret - m[1].length - 1, query: m[1] }
  }

  async function runMentionSearch(query: string) {
    if (!query) {
      setUsers([])
      return
    }
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

  function onChange(value: string) {
    setVal(value)
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const m = detectMention(value, caret)
    setMention(m)
    if (m) void runMentionSearch(m.query)
    else setUsers([])
  }

  function pickMention(u: MentionUser) {
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const next = val.slice(0, mention.start) + `@${u.handle} ` + val.slice(end)
    setVal(next)
    setMention(null)
    setUsers([])
    restore(mention.start + u.handle.length + 2, mention.start + u.handle.length + 2)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Меню @mention перехватывает навигацию
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
    // Tab-отступ (2 пробела); Shift+Tab — снять
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const s = el.selectionStart
      const en = el.selectionEnd
      const lineStart = val.lastIndexOf('\n', s - 1) + 1
      if (e.shiftKey) {
        const block = val.slice(lineStart, en)
        const dedented = block.replace(/^ {1,2}/gm, '')
        setVal(val.slice(0, lineStart) + dedented + val.slice(en))
        restore(Math.max(lineStart, s - 2), en - (block.length - dedented.length))
      } else if (s !== en) {
        const block = val.slice(lineStart, en)
        const indented = block.replace(/^/gm, '  ')
        setVal(val.slice(0, lineStart) + indented + val.slice(en))
        restore(s + 2, en + (indented.length - block.length))
      } else {
        insertAt('  ')
      }
    }
  }

  const groups: { icon: typeof Bold; t: string; run: () => void }[][] = [
    [
      { icon: Heading, t: L('заголовок', 'heading'), run: () => linePrefix(() => '### ') },
      { icon: Bold, t: L('жирный', 'bold'), run: () => surround('**', '**', L('текст', 'text')) },
      { icon: Italic, t: L('курсив', 'italic'), run: () => surround('_', '_', L('текст', 'text')) },
      { icon: Strikethrough, t: L('зачёркнутый', 'strikethrough'), run: () => surround('~~', '~~', L('текст', 'text')) },
    ],
    [
      { icon: Quote, t: L('цитата', 'quote'), run: () => linePrefix(() => '> ') },
      { icon: Code, t: L('код', 'code'), run: () => surround('`', '`', 'code') },
      { icon: Link2, t: L('ссылка', 'link'), run: () => surround('[', '](url)', L('текст', 'text')) },
    ],
    [
      { icon: List, t: L('список', 'bulleted list'), run: () => linePrefix(() => '- ') },
      { icon: ListOrdered, t: L('нумерованный', 'numbered list'), run: () => linePrefix((i) => `${i + 1}. `) },
      { icon: ListChecks, t: L('чек-лист', 'task list'), run: () => linePrefix(() => '- [ ] ') },
    ],
  ]

  return (
    <div className={`overflow-hidden rounded-md border border-border bg-surface ${className ?? ''}`}>
      {/* Табы + тулбар */}
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

            {/* Группа вставки: картинка, вложение, mention, эмодзи */}
            <span className="mx-1 h-4 w-px bg-border" />
            <button type="button" title={L('картинка', 'image')} aria-label={L('картинка', 'image')} onClick={() => imgInput.current?.click()} className={btn}>
              <ImageIcon size={15} />
            </button>
            <button type="button" title={L('файл', 'attach file')} aria-label={L('файл', 'attach file')} onClick={() => fileInput.current?.click()} className={btn}>
              <Paperclip size={15} />
            </button>
            <button
              type="button"
              title={L('упомянуть', 'mention')}
              aria-label={L('упомянуть', 'mention')}
              onClick={() => {
                insertAt('@')
                setTab('write')
              }}
              className={btn}
            >
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
                      onEmojiSelect={(e: { native?: string }) => {
                        if (e.native) insertAt(e.native)
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

      {/* Тело */}
      <div className={`relative ${tab === 'preview' ? 'hidden' : ''}`}>
        <textarea
          ref={ref}
          name={name}
          value={val}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files)
            if (imgs.length) {
              e.preventDefault()
              uploadFiles(imgs)
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

        {/* @mention автодополнение */}
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
