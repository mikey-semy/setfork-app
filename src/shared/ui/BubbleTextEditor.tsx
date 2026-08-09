'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { caretCoords } from './caret-coords'
import { BubbleToolbar } from './BubbleToolbar'
import { markdownToolbarGroups } from './markdown-toolbar'
import { MentionList } from './MentionList'
import { TEXT } from './control'
import { useMention } from './use-mention'

// Редактор текста со ВСПЛЫВАЮЩЕЙ (bubble) панелью: появляется, пока работаешь с
// текстом (фокус/выделение), плавает у курсора и НЕ перекрывает текст. Полный набор
// форматирования + список + эмодзи + @упоминания. БЕЗ картинок/файлов — для них
// отдельные блоки. Управляемый (value/onChange), рендерится Markdown'ом.
//
// Здесь остались только текст и каретка: панель инструментов живёт в
// BubbleToolbar, упоминания — в useMention/MentionList. Раньше всё это лежало в
// одном компоненте, и правка панели неизбежно ехала рядом с поиском людей.
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
  // Последнее выделение: пикер эмодзи забирает фокус, и вставлять надо туда, где
  // человек стоял до его открытия.
  const savedSel = useRef<[number, number]>([0, 0])
  // Пикер эмодзи и меню «⋯» живут в портале: фокус уходит из поля, но панель
  // закрывать нельзя — иначе выбранный смайлик вставлять уже некуда.
  const overlayOpen = useRef(false)
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)

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

  const mention = useMention({ value, ref, apply })

  // Позиция панели у текущего курсора/выделения (флип: над строкой либо под ней).
  function refresh() {
    const el = ref.current
    if (!el) return
    savedSel.current = [el.selectionStart, el.selectionEnd]
    if (mention.mention) {
      setBubble(null)
      return
    } // при активном @-меню панель прячем
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
    const replaced = block
      .split('\n')
      .map((l, i) => make(i) + l)
      .join('\n')
    apply(value.slice(0, start) + replaced + value.slice(e), start, start + replaced.length)
  }

  function insertAtRange(text: string, s: number, e: number) {
    apply(value.slice(0, s) + text + value.slice(e), s + text.length, s + text.length)
  }

  function onChangeText(v: string) {
    onChange(v)
    if (mention.onText(v)) setBubble(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.onKeyDown(e)) return
    if (singleLine && e.key === 'Enter') {
      e.preventDefault()
      return
    } // одно-строчное поле
    if (!(e.metaKey || e.ctrlKey)) return
    const k = e.key.toLowerCase()
    if (k === 'b') {
      e.preventDefault()
      surround('**', '**', L('текст', 'text'))
    } else if (k === 'i') {
      e.preventDefault()
      surround('_', '_', L('текст', 'text'))
    } else if (k === 'k') {
      e.preventDefault()
      surround('[', '](url)', L('текст', 'text'))
    }
  }

  // Все инструменты одним рядом: что не влезло — уходит в «⋯». Порядок групп
  // сохраняем, он от частого к редкому.
  const tools = markdownToolbarGroups({ L, surround, linePrefix }).flat()

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
        onBlur={() =>
          setTimeout(() => {
            if (!overlayOpen.current) {
              setBubble(null)
              mention.close()
            }
          }, 150)
        }
        // `block` обязателен: textarea по умолчанию inline-block, и под базовой
        // линией остаётся зазор — обёртка становится на 7px выше поля, а иконка
        // рядом (например «H» у строки урока) центрируется по обёртке и уезжает
        // относительно текста. Замер 09.08.2026: расхождение осей ровно 4px.
        className={`block w-full ${TEXT.body} leading-relaxed text-ink outline-hidden ${
          bare ? 'resize-none overflow-hidden bg-transparent' : 'rounded-md border border-border bg-surface-2 px-3 py-2 focus:border-border-strong'
        } ${singleLine && !bare ? 'resize-none overflow-hidden' : bare ? '' : 'min-h-[4.5rem] resize-y'} ${trailing ? 'pr-9' : ''} ${mono ? `font-mono ${TEXT.bodySm}` : ''} ${textareaClassName ?? ''}`}
      />
      {trailing && <div className="absolute right-1.5 top-1.5">{trailing}</div>}

      {bubble && !mention.mention && (
        <BubbleToolbar
          tools={tools}
          at={bubble}
          lang={lang}
          onMention={() => insertAtRange('@', savedSel.current[0], savedSel.current[1])}
          onEmoji={(native) => insertAtRange(native, savedSel.current[0], savedSel.current[1])}
          onOverlay={(open) => {
            overlayOpen.current = open
          }}
        />
      )}

      {mention.mention && mention.users.length > 0 && (
        <MentionList users={mention.users} index={mention.index} onHover={mention.setIndex} onPick={mention.pick} at={mention.anchor} />
      )}
    </div>
  )
}
