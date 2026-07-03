'use client'
import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { Bold, Code, Heading, ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, Quote, SmilePlus, Strikethrough } from 'lucide-react'
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
  /** Доп. классы на внешний контейнер. */
  className?: string
}

// Богатый markdown-редактор (Write/Preview + тулбар + эмодзи + картинки).
// Управляемая <textarea name={name}> — сабмитится в обычных <form action={...}>.
export function MarkdownEditor({ name, defaultValue = '', placeholder, rows = 6, maxLength, autoFocus, lang = 'en', className }: Props) {
  const [val, setVal] = useState(defaultValue)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [busy, setBusy] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  // Обернуть выделение (bold/italic/code/link/strike).
  function surround(before: string, after = before, ph = '') {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = val.slice(s, e) || ph
    setVal(val.slice(0, s) + before + sel + after + val.slice(e))
    restore(s + before.length, s + before.length + sel.length)
  }

  // Префикс на каждую выделенную строку (списки/цитата/заголовок).
  function linePrefix(make: (i: number) => string) {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const start = val.lastIndexOf('\n', s - 1) + 1
    const block = val.slice(start, e) || ''
    const replaced = block
      .split('\n')
      .map((l, i) => make(i) + l)
      .join('\n')
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
      if (!file.type.startsWith('image/')) continue
      const token = `![uploading ${file.name}…](…${Math.round(performance.now())})`
      insertAt(token + '\n')
      setBusy((b) => b + 1)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
        setVal((v) => v.replace(token, res.ok && data.url ? `![${file.name}](${data.url})` : `*(${L('загрузка не удалась', 'upload failed')})*`))
      } catch {
        setVal((v) => v.replace(token, `*(${L('загрузка не удалась', 'upload failed')})*`))
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  const tools = [
    { icon: Heading, t: L('заголовок', 'heading'), run: () => linePrefix(() => '### ') },
    { icon: Bold, t: L('жирный', 'bold'), run: () => surround('**', '**', L('текст', 'text')) },
    { icon: Italic, t: L('курсив', 'italic'), run: () => surround('_', '_', L('текст', 'text')) },
    { icon: Strikethrough, t: L('зачёркнутый', 'strikethrough'), run: () => surround('~~', '~~', L('текст', 'text')) },
    { icon: Quote, t: L('цитата', 'quote'), run: () => linePrefix(() => '> ') },
    { icon: Code, t: L('код', 'code'), run: () => surround('`', '`', 'code') },
    { icon: Link2, t: L('ссылка', 'link'), run: () => surround('[', '](url)', L('текст', 'text')) },
    { icon: List, t: L('список', 'bulleted list'), run: () => linePrefix(() => '- ') },
    { icon: ListOrdered, t: L('нумерованный', 'numbered list'), run: () => linePrefix((i) => `${i + 1}. `) },
    { icon: ListChecks, t: L('чек-лист', 'task list'), run: () => linePrefix(() => '- [ ] ') },
  ]

  return (
    <div className={`overflow-hidden rounded-md border border-border bg-surface ${className ?? ''}`}>
      {/* Табы + тулбар */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-2 px-1.5 py-1">
        <div className="mr-1 flex overflow-hidden rounded border border-border">
          {(['write', 'preview'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-2.5 py-1 text-[12.5px] font-semibold ${tab === k ? 'bg-surface text-ink' : 'bg-surface-2 text-muted hover:text-ink'}`}
            >
              {k === 'write' ? L('Написать', 'Write') : L('Просмотр', 'Preview')}
            </button>
          ))}
        </div>

        {tab === 'write' && (
          <div className="flex flex-wrap items-center gap-0.5">
            {tools.map((tool, i) => (
              <button key={i} type="button" title={tool.t} aria-label={tool.t} onClick={tool.run} className="rounded p-1 text-muted hover:bg-surface hover:text-ink">
                <tool.icon size={15} />
              </button>
            ))}
            <button type="button" title={L('картинка', 'image')} aria-label={L('картинка', 'image')} onClick={() => fileRef.current?.click()} className="rounded p-1 text-muted hover:bg-surface hover:text-ink">
              <ImageIcon size={15} />
            </button>
            <div className="relative">
              <button type="button" title={L('эмодзи', 'emoji')} aria-label={L('эмодзи', 'emoji')} onClick={() => setEmojiOpen((o) => !o)} className="rounded p-1 text-muted hover:bg-surface hover:text-ink">
                <SmilePlus size={15} />
              </button>
              {emojiOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
                  <div className="absolute left-0 z-20 mt-1">
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
            </div>
          </div>
        )}
      </div>

      {/* Скрытый input для картинок */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) uploadFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />

      {/* Тело: textarea (Write) всегда в DOM ради сабмита; Preview поверх */}
      <div className={tab === 'preview' ? 'hidden' : ''}>
        <textarea
          ref={ref}
          name={name}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
            if (imgs.length) {
              e.preventDefault()
              uploadFiles(imgs)
            }
          }}
          onDrop={(e) => {
            const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
            if (imgs.length) {
              e.preventDefault()
              uploadFiles(imgs)
            }
          }}
          className="w-full resize-y bg-surface px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted"
        />
      </div>
      {tab === 'preview' && (
        <div className="min-h-[80px] px-3 py-2.5">
          {val.trim() ? <Markdown>{val}</Markdown> : <p className="text-[13px] italic text-muted">{L('Нечего показывать', 'Nothing to preview')}</p>}
        </div>
      )}

      {/* Футер-подсказка */}
      <div className="flex items-center gap-2 border-t border-border bg-surface-2 px-3 py-1.5 text-[11.5px] text-muted">
        <span>{L('Поддерживается Markdown', 'Markdown supported')}</span>
        <span className="text-border">·</span>
        <button type="button" onClick={() => fileRef.current?.click()} className="hover:text-ink">
          {L('вставьте или прикрепите картинки', 'paste or attach images')}
        </button>
        {busy > 0 && <span className="text-accent">· {L('загрузка…', 'uploading…')}</span>}
      </div>
    </div>
  )
}
